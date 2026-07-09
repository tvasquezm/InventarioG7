// ======================================================
// Payments Consumer - consume eventos de pago de G6
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================
//
// Se suscribe a payment.approved / payment.rejected en el exchange
// compartido (fishmarket) con cola propia durable
// (g7-inventory-service, definida por G7 segun acuerdo con G5):
//
//   payment.approved -> confirmar la reserva del pedido (stock sale definitivo)
//   payment.rejected -> liberar la reserva (stock vuelve a disponible)
//
// Cierra el hueco real del flujo: G5 marca el pedido PAID al aprobarse
// el pago pero nunca llama a nuestro /confirm, dejando stock reservado
// para siempre. Con este consumidor el inventario reacciona solo.
//
// CAPA DE ADAPTACION: el sobre de G6 NO es estandar (usa eventName y
// timestamp; no trae correlationId ni producer). adaptPaymentEvent()
// normaliza ambos formatos por si G6 migra al sobre del curso.
//
// IDEMPOTENCIA DE CONSUMO (caso obligatorio): los eventos procesados se
// registran en inventario.processed_events por event_id; un evento
// re-entregado no confirma/libera dos veces. Ademas confirm/release son
// idempotentes por si mismos (FOR UPDATE + transicion condicional).

import amqp from "amqplib";
import crypto from "crypto";
import { repository } from "../repository/repository";
import { reservationService } from "../domain/reservations";
import { ApiError } from "../middlewares/error.middleware";

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || "fishmarket";
const QUEUE = process.env.RABBITMQ_QUEUE || "g7-inventory-service";
const ROUTING_KEYS = ["payment.approved", "payment.rejected", "OrderCreated"];
const RECONNECT_MS = 5000;

interface AdaptedPaymentEvent {
  eventId: string;
  eventType: string;
  correlationId: string;
  orderId: string | null;
  paymentId: string | null;
}

/**
 * Normaliza el evento de G6 (sobre no estandar) o uno con sobre estandar.
 */
function adaptPaymentEvent(raw: any, routingKey: string): AdaptedPaymentEvent {
  return {
    eventId: raw.eventId ?? crypto.randomUUID(),
    eventType: raw.eventType ?? raw.eventName ?? routingKey,
    correlationId: raw.correlationId ?? crypto.randomUUID(),
    orderId: raw.payload?.orderId ?? raw.orderId ?? null,
    paymentId: raw.payload?.paymentId ?? raw.paymentId ?? null
  };
}

/**
 * OrderCreated de G5 (sobre estandar): enlaza la reserva con el UUID
 * interno de la orden y el userId (business_user_id) del comprador.
 * - order_uuid: los pagos pueden venir con este UUID en vez del
 *   orderNumber; con ambos guardados la reserva se resuelve siempre.
 * - user_id: alimenta el StockRejected v1.1 que necesita G9.
 * Su payload trae reservationId (nuestra PK, devuelta por /reserve),
 * orderNumber y orderId (UUID): enlazamos por los dos primeros.
 */
async function handleOrderCreated(raw: any): Promise<void> {

  const eventId: string = raw.eventId ?? crypto.randomUUID();
  const correlationId: string = raw.correlationId ?? crypto.randomUUID();
  const p = raw.payload ?? {};
  const tag = `[consumer] eventId=${eventId} correlationId=${correlationId}`;

  if (await repository.hasProcessedEvent(eventId)) {
    console.log(`${tag} OrderCreated duplicado: se ignora.`);
    return;
  }

  const linked = await repository.linkOrderReference(
    p.reservationId ?? null,
    p.orderNumber ?? null,
    p.orderId ?? null,
    p.userId ?? null
  );

  if (linked) {
    console.log(
      `${tag} OrderCreated: reserva enlazada ` +
      `(orderNumber=${p.orderNumber} orderUuid=${p.orderId} userId=${p.userId})`
    );
  } else {
    console.log(`${tag} OrderCreated sin reserva en inventario: no aplica.`);
  }

  await repository.markProcessedEvent(eventId, "OrderCreated");
}

async function handlePaymentEvent(
  routingKey: string,
  event: AdaptedPaymentEvent
): Promise<void> {

  const tag = `[consumer] eventId=${event.eventId} correlationId=${event.correlationId}`;

  if (!event.orderId) {
    console.warn(`${tag} ${routingKey} sin orderId en el payload: se ignora.`);
    return;
  }

  // Idempotencia de consumo: evento ya procesado -> no repetir.
  if (await repository.hasProcessedEvent(event.eventId)) {
    console.log(`${tag} duplicado (ya en processed_events): se ignora.`);
    return;
  }

  try {

    if (routingKey === "payment.approved") {
      const r = await reservationService.confirmReservation(
        event.orderId,
        event.correlationId
      );
      console.log(
        `${tag} pago aprobado -> reserva ${r.reservationId} CONFIRMADA (orden ${event.orderId})`
      );
    } else {
      const r = await reservationService.releaseReservation(
        event.orderId,
        event.correlationId
      );
      console.log(
        `${tag} pago rechazado -> reserva ${r.reservationId} LIBERADA (orden ${event.orderId})`
      );
    }

  } catch (err) {

    if (err instanceof ApiError && err.status === 404) {
      // Pago de un pedido sin reserva en inventario (p. ej. pruebas de
      // otros grupos): no aplica, pero el evento queda como procesado.
      console.log(`${tag} orden ${event.orderId} sin reserva en inventario: no aplica.`);
    } else if (err instanceof ApiError && err.status === 409) {
      // La reserva ya esta en estado final (confirmada/liberada antes).
      console.log(`${tag} reserva de ${event.orderId} ya en estado final: no aplica.`);
    } else {
      // Error transitorio (p. ej. BD caida): NO marcar como procesado.
      throw err;
    }
  }

  await repository.markProcessedEvent(event.eventId, event.eventType);
}

async function connectAndConsume(): Promise<void> {

  const connection = await amqp.connect(RABBITMQ_URL!);

  connection.on("error", (err) => {
    console.error("[consumer] conexion RabbitMQ cayo:", err.message);
  });
  connection.on("close", () => {
    console.warn(`[consumer] conexion cerrada; reintento en ${RECONNECT_MS}ms`);
    setTimeout(() => startPaymentsConsumer(), RECONNECT_MS);
  });

  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });

  // Cola propia de G7, durable: si el servicio se cae (o Render lo
  // duerme), los eventos quedan esperando y se procesan al volver.
  await channel.assertQueue(QUEUE, { durable: true });
  for (const key of ROUTING_KEYS) {
    await channel.bindQueue(QUEUE, EXCHANGE, key);
  }

  await channel.prefetch(5);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    const routingKey = msg.fields.routingKey;

    try {
      const raw = JSON.parse(msg.content.toString());
      if (routingKey === "OrderCreated") {
        await handleOrderCreated(raw);
      } else {
        const event = adaptPaymentEvent(raw, routingKey);
        await handlePaymentEvent(routingKey, event);
      }
      channel.ack(msg);
    } catch (err: any) {
      // Mensaje ilegible o error transitorio: se descarta sin requeue
      // (mismo criterio que G5/G9; un requeue infinito bloquea la cola).
      console.error(`[consumer] error procesando ${routingKey}:`, err.message);
      channel.nack(msg, false, false);
    }
  });

  console.log(
    `[consumer] cola ${QUEUE} escuchando ${ROUTING_KEYS.join(", ")} en ${EXCHANGE}`
  );
}

/**
 * Arranca el consumidor de eventos de pago. Sin RABBITMQ_URL el servicio
 * funciona igual (solo sin confirmacion/liberacion automatica).
 */
export function startPaymentsConsumer(): void {
  if (!RABBITMQ_URL) {
    console.warn(
      "[consumer] RABBITMQ_URL no definida: consumo de eventos de pago desactivado."
    );
    return;
  }

  connectAndConsume().catch((err) => {
    console.error("[consumer] no se pudo conectar:", err.message);
    setTimeout(() => startPaymentsConsumer(), RECONNECT_MS);
  });
}
