// ======================================================
// Outbox Dispatcher - publica el outbox a RabbitMQ
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================
//
// Cada DISPATCH_INTERVAL_MS toma un lote de eventos pendientes del
// outbox (FOR UPDATE SKIP LOCKED: seguro con varias instancias) y los
// publica al exchange topic compartido del curso (payments.events en
// CloudAMQP; el mismo que usan G5 y G6). Routing key = eventType.
//
// Entrega "al menos una vez": si el proceso muere entre publicar y
// marcar published_at, el evento se re-publica en el siguiente ciclo
// (mismo eventId); los consumidores deduplican por event_id.

import amqp from "amqplib";
import { withTransaction } from "../config/database";
import { repository } from "../repository/repository";

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || "payments.events";
const DISPATCH_INTERVAL_MS = Number(process.env.OUTBOX_INTERVAL_MS || 5000);
const BATCH_SIZE = 20;

let connection: amqp.ChannelModel | null = null;
let channel: amqp.Channel | null = null;
let dispatching = false;

async function ensureChannel(): Promise<amqp.Channel> {
  if (channel) return channel;

  connection = await amqp.connect(RABBITMQ_URL!);

  connection.on("error", (err) => {
    console.error("[dispatcher] conexion RabbitMQ cayo:", err.message);
    channel = null;
    connection = null;
  });
  connection.on("close", () => {
    channel = null;
    connection = null;
  });

  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });

  console.log(`[dispatcher] conectado a RabbitMQ (exchange ${EXCHANGE})`);
  return channel;
}

async function dispatchPending(): Promise<void> {
  // Evita ciclos solapados si un lote tarda mas que el intervalo.
  if (dispatching) return;
  dispatching = true;

  try {
    const ch = await ensureChannel();

    await withTransaction(async (client) => {
      const events = await repository.claimPendingOutbox(BATCH_SIZE, client);

      for (const e of events) {
        const message = {
          eventId: e.eventId,
          eventType: e.eventType,
          version: e.version,
          occurredAt: e.occurredAt,
          producer: "inventory-service",
          correlationId: e.correlationId,
          payload: e.payload
        };

        ch.publish(
          EXCHANGE,
          e.routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            messageId: e.eventId,
            correlationId: e.correlationId ?? undefined,
            contentType: "application/json"
          }
        );

        await repository.markOutboxPublished(e.id, client);

        console.log(
          `[dispatcher] publicado ${e.eventType} eventId=${e.eventId} ` +
          `routingKey=${e.routingKey}`
        );
      }
    });
  } catch (err: any) {
    console.error("[dispatcher] error publicando outbox:", err.message);
    channel = null;
  } finally {
    dispatching = false;
  }
}

/**
 * Arranca el ciclo de despacho. Si RABBITMQ_URL no esta configurada,
 * el servicio funciona igual: los eventos quedan encolados en el outbox
 * (visibles en la tabla) y se publicaran cuando haya broker.
 */
export function startOutboxDispatcher(): void {
  if (!RABBITMQ_URL) {
    console.warn(
      "[dispatcher] RABBITMQ_URL no definida: los eventos quedaran " +
      "encolados en inventario.outbox_events sin publicarse."
    );
    return;
  }

  dispatchPending();
  setInterval(dispatchPending, DISPATCH_INTERVAL_MS);

  console.log(
    `[dispatcher] despacho del outbox cada ${DISPATCH_INTERVAL_MS}ms`
  );
}
