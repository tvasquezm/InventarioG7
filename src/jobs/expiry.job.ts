// ======================================================
// Expiry Job - expiracion batch de reservas vencidas
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================
//
// Proceso BATCH periodico (concepto asignado a G7): cada ciclo toma un
// lote de reservas RESERVED cuyo TTL (expires_at) ya vencio y, en una
// sola transaccion por lote:
//
//   1. Devuelve el stock reservado a disponible (releaseRestore).
//   2. Transiciona la reserva RESERVED -> EXPIRED (condicional).
//   3. Encola InventoryReleased con reason "EXPIRED" (outbox), para que
//      G5/G3 se enteren de que el stock volvio.
//
// Concurrencia: el lote se reclama con FOR UPDATE SKIP LOCKED, asi que
// varias instancias no procesan la misma reserva dos veces, y un
// confirm/release que llegue justo en ese momento queda serializado por
// el lock de fila (el que pierde ve el estado final y responde 409).
//
// Render free: el job corre mientras el servicio esta despierto. Si el
// servicio durmio, el primer ciclo tras despertar limpia todo lo
// acumulado (el batch se pone al dia solo).

import crypto from "crypto";
import { withTransaction } from "../config/database";
import { repository } from "../repository/repository";
import { publisher } from "../events/publisher";

const EXPIRY_INTERVAL_MS = Number(process.env.EXPIRY_INTERVAL_MS || 60000);
const BATCH_SIZE = 50;

let running = false;

async function expireBatch(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const correlationId = `expiry-${crypto.randomUUID()}`;

    const expired = await withTransaction(async (client) => {

      const reservations = await repository.claimExpiredReservations(BATCH_SIZE, client);

      for (const reservation of reservations) {

        // Mismo orden de locks que reserva/confirm/release (anti-deadlock).
        const orderedItems = [...reservation.items].sort((a, b) =>
          a.productId.localeCompare(b.productId)
        );

        for (const item of orderedItems) {
          const ok = await repository.releaseRestore(item.productId, item.quantity, client);
          if (!ok) {
            // Stock reservado inconsistente (p. ej. un SET admin lo
            // reseteo). Se deja constancia y la reserva expira igual:
            // dejarla RESERVED la haria reintentar por siempre.
            console.warn(
              `[expiry] correlationId=${correlationId} reserva ${reservation.reservationId}: ` +
              `no se pudo devolver ${item.quantity} de ${item.productId} (reservado insuficiente)`
            );
          }
        }

        const transitioned = await repository.updateReservationStatus(
          reservation.reservationId,
          "EXPIRED",
          client
        );

        if (transitioned) {
          reservation.status = "EXPIRED";
          await publisher.publishReservationReleased(
            correlationId,
            reservation,
            client,
            "EXPIRED"
          );
          console.log(
            `[expiry] correlationId=${correlationId} reserva ${reservation.reservationId} ` +
            `(orden ${reservation.orderId}) EXPIRADA; stock devuelto`
          );
        }
      }

      return reservations.length;
    });

    if (expired > 0) {
      console.log(`[expiry] ciclo completado: ${expired} reserva(s) expiradas`);
    }
  } catch (err: any) {
    console.error("[expiry] error en el ciclo de expiracion:", err.message);
  } finally {
    running = false;
  }
}

/**
 * Arranca el job batch de expiracion (primer ciclo inmediato: si el
 * servicio estuvo dormido, se pone al dia con lo acumulado).
 */
export function startExpiryJob(): void {
  expireBatch();
  setInterval(expireBatch, EXPIRY_INTERVAL_MS);
  console.log(`[expiry] job batch de expiracion cada ${EXPIRY_INTERVAL_MS}ms (TTL de reservas: 15 min)`);
}
