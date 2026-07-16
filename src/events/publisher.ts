// ======================================================
// Publisher - Outbox Event Publisher (Fase 4)
// Grupo 7 - Inventory Service
// ======================================================
//
// Fase 2/3: los eventos se imprimian en consola (mock).
// Fase 4: patron OUTBOX. Cada metodo inserta el evento en
// inventario.outbox_events DENTRO de la transaccion que cambia el
// stock; el dispatcher (events/dispatcher.ts) lo publica despues a
// RabbitMQ (exchange compartido 'fishmarket') y marca published_at.
//
// Por que: si el evento se publicara directo dentro de la transaccion
// y el COMMIT fallara, el ecosistema recibiria un evento de algo que
// nunca ocurrio (evento fantasma). Con outbox, evento y cambio de stock
// se confirman o se descartan JUNTOS.

import crypto from "crypto";
import { Db, pool } from "../config/database";
import { repository, Reservation } from "../repository/repository";

// Sobre estandar de eventos del curso.
export interface InventoryEvent<TPayload = unknown> {
  eventId: string;
  eventType: string;
  version: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  payload: TPayload;
}

const PRODUCER = "inventory-service";

export class Publisher {

  /**
   * Encola el evento en el outbox (misma transaccion que el cambio de
   * stock si se pasa el client; con pool queda en transaccion propia).
   * El routing key en el exchange topic es el eventType, igual que G5.
   */
  private async enqueue<TPayload>(
    eventType: string,
    correlationId: string,
    payload: TPayload,
    db: Db,
    version: string = "1.0"
  ): Promise<void> {

    const event: InventoryEvent<TPayload> = {
      eventId: crypto.randomUUID(),
      eventType,
      version,
      occurredAt: new Date().toISOString(),
      producer: PRODUCER,
      correlationId,
      payload
    };

    await repository.insertOutboxEvent(event, eventType, db);

    console.log(
      `[outbox] encolado ${eventType} eventId=${event.eventId} ` +
      `correlationId=${correlationId}`
    );
  }

  // v2.0 (acordado con G5): orderId pasa a ser el UUID interno de la orden
  // en G5 (su PK, como ya lo publican G6/G8/G9) y orderNumber conserva el
  // identificador de negocio ("ORD-..."). orderId puede ser null en reservas
  // previas a v1.7 cuyo OrderCreated nunca llego: los consumidores deben
  // caer a orderNumber en ese caso.

  async publishReservationCreated(
    correlationId: string,
    reservation: Reservation,
    db: Db
  ): Promise<void> {
    await this.enqueue("StockReserved", correlationId, {
      reservationId: reservation.reservationId,
      orderId: reservation.orderUuid,
      orderNumber: reservation.orderId,
      userId: reservation.userId,
      status: reservation.status,
      items: reservation.items,
      expiresAt: reservation.expiresAt
    }, db, "2.0");
  }

  async publishReservationConfirmed(
    correlationId: string,
    reservation: Reservation,
    db: Db
  ): Promise<void> {
    await this.enqueue("StockConfirmed", correlationId, {
      reservationId: reservation.reservationId,
      orderId: reservation.orderUuid,
      orderNumber: reservation.orderId,
      status: reservation.status,
      items: reservation.items
    }, db, "2.0");
  }

  /**
   * Liberacion de reserva. eventType/routing key: InventoryReleased
   * (nombre acordado con G5: su consumidor ya esta suscrito a esa key;
   * antes lo llamabamos StockReleased, renombrado en el contrato v1.4).
   * El job de expiracion pasa reason "EXPIRED" (para el consumidor, una
   * expiracion es lo mismo que una liberacion: el stock volvio).
   */
  async publishReservationReleased(
    correlationId: string,
    reservation: Reservation,
    db: Db,
    reason?: string
  ): Promise<void> {
    await this.enqueue("InventoryReleased", correlationId, {
      reservationId: reservation.reservationId,
      orderId: reservation.orderUuid,
      orderNumber: reservation.orderId,
      status: reservation.status,
      items: reservation.items,
      ...(reason ? { reason } : {})
    }, db, "2.0");
  }

  /**
   * Reserva rechazada por falta de stock. OJO: se llama DESPUES del
   * ROLLBACK de la reserva (con pool, no con el client de la transaccion
   * abortada): el rechazo si debe publicarse aunque la reserva no exista.
   * Como aqui no hay fila en BD, el orderId (uuid) sale del orderUuid que
   * G5 mando en el body del reserve (null si no vino).
   */
  async publishStockRejected(
    correlationId: string,
    payload: { orderId: string | null; orderNumber: string; userId: string | null; reason: string; items: any[] }
  ): Promise<void> {
    await this.enqueue("StockRejected", correlationId, payload, pool, "2.0");
  }

  async publishStockChanged(
    productId: string,
    inventoryView: {
      availableStock: number;
      totalStock: number;
      virtualStock: number;
    },
    correlationId: string,
    db: Db
  ): Promise<void> {
    await this.enqueue("StockChanged", correlationId, {
      productId,
      availableStock: inventoryView.availableStock,
      totalStock: inventoryView.totalStock,
      // virtualStock = stock vendible (lo que G3 debe reflejar en stock_visible)
      virtualStock: inventoryView.virtualStock
    }, db);
  }

}

export const publisher = new Publisher();
