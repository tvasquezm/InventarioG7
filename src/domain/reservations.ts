import crypto from "crypto";
import { publisher } from "../events/publisher";
import { withTransaction } from "../config/database";

import {
  repository,
  Reservation,
  ReservationItem
} from "../repository/repository";

import { ApiError } from "../middlewares/error.middleware";

// ========================================
// TIPOS DE ENTRADA / SALIDA
// ========================================

export interface ReserveStockRequest {
  orderId: string;
  idempotencyKey: string;
  items: ReservationItem[];
  ttlMinutes?: number;
  correlationId: string;
  // business_user_id del comprador (USR-01 de G2). Opcional (v1.6):
  // G5 lo envia para que StockRejected pueda incluirlo (lo pide G9).
  userId?: string;
}

export interface ReserveStockResult {
  reservation: Reservation;
  isIdempotentReplay: boolean;
}

// ========================================
// CONFIG
// ========================================

const DEFAULT_RESERVATION_TTL_MINUTES = 15;

// ========================================
// SERVICE
// ========================================

export class ReservationService {

  async reserveStock(
    request: ReserveStockRequest
  ): Promise<ReserveStockResult> {

    const {
      orderId,
      idempotencyKey,
      items,
      correlationId,
      userId
    } = request;

    // ========================================
    // VALIDACIONES BASICAS (sin BD)
    // ========================================

    if (!orderId || orderId.trim().length === 0) {
      throw new ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
    }

    if (userId !== undefined && typeof userId !== "string") {
      throw new ApiError(400, "INVALID_USER_ID", "userId must be a string when provided.");
    }

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "idempotencyKey is required.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, "INVALID_ITEMS", "At least one item is required.");
    }

    for (const item of items) {
      if (!item.productId || item.productId.trim().length === 0) {
        throw new ApiError(400, "INVALID_PRODUCT_ID", "Each item must include a valid productId.");
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new ApiError(400, "INVALID_QUANTITY", "Each item must include a quantity greater than 0.");
      }
    }

    // ========================================
    // TRANSACCION: todo-o-nada con control de
    // concurrencia real (UPDATE condicional + locks de fila).
    // ========================================

    try {
      return await this.reserveStockTx(request);
    } catch (error) {
      // El rechazo por falta de stock SI se publica (fuera de la
      // transaccion abortada: el outbox de una tx con ROLLBACK no existe).
      if (error instanceof ApiError && error.code === "OUT_OF_STOCK") {
        // v1.1: incluye userId (si G5 lo mando en el reserve) para que
        // G9 sepa a quien notificar el rechazo.
        await publisher.publishStockRejected(correlationId, {
          orderId,
          userId: userId?.trim() || null,
          reason: error.message,
          items
        });
      }
      throw error;
    }
  }

  private async reserveStockTx(
    request: ReserveStockRequest
  ): Promise<ReserveStockResult> {

    const {
      orderId,
      idempotencyKey,
      items,
      ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES,
      correlationId,
      userId
    } = request;

    return withTransaction(async (client) => {

      // --- Idempotencia ---
      const existingReservation =
        await repository.findReservationByIdempotencyKey(idempotencyKey, client);

      if (existingReservation) {
        if (existingReservation.orderId !== orderId) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency-Key already used for a different order."
          );
        }
        return { reservation: existingReservation, isIdempotentReplay: true };
      }

      // --- El orderId no debe estar ya reservado ---
      const reservationByOrderId =
        await repository.getReservation(orderId, client);

      if (reservationByOrderId) {
        throw new ApiError(
          409,
          "ORDER_ALREADY_RESERVED",
          "A reservation already exists for this orderId."
        );
      }

      // --- Descuento atomico por item ---
      // Los items se procesan SIEMPRE ordenados por productId: dos reservas
      // concurrentes con productos en comun toman los locks de fila en el
      // mismo orden, lo que evita deadlocks (espera circular) en Postgres.
      const orderedItems = [...items].sort((a, b) =>
        a.productId.localeCompare(b.productId)
      );

      const reservedItems: ReservationItem[] = [];

      for (const item of orderedItems) {

        // Existencia del producto (para distinguir 404 de 422).
        const exists = await repository.existsInventory(item.productId, client);
        if (!exists) {
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product ${item.productId} not found.`
          );
        }

        // UPDATE ... WHERE available_stock >= qty.
        // Si devuelve null, no habia stock (otra transaccion gano).
        const remaining =
          await repository.reserveDecrement(item.productId, item.quantity, client);

        if (remaining === null) {
          // El StockRejected lo publica reserveStock() tras el ROLLBACK.
          throw new ApiError(
            422,
            "OUT_OF_STOCK",
            `Insufficient stock for product ${item.productId}.`
          );
        }

        reservedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          availableStock: remaining
        });
      }

      // --- Crear la reserva ---
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

      const reservation: Reservation = {
        reservationId: crypto.randomUUID(),
        orderId,
        idempotencyKey,
        status: "RESERVED",
        items: reservedItems,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        userId: userId?.trim() || null,
        orderUuid: null
      };

      await repository.insertReservation(reservation, client);

      // Outbox: se confirma junto con la reserva (misma transaccion).
      await publisher.publishReservationCreated(correlationId, reservation, client);

      return { reservation, isIdempotentReplay: false };
    });
  }

  async confirmReservation(
    orderId: string,
    correlationId: string
  ): Promise<Reservation> {

    if (!orderId || orderId.trim().length === 0) {
      throw new ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
    }

    return withTransaction(async (client) => {

      // FOR UPDATE: serializa confirmaciones/liberaciones concurrentes del
      // mismo pedido. La segunda transaccion espera el COMMIT de la primera
      // y relee el estado ya actualizado (no puede procesar dos veces).
      const reservation = await repository.getReservationForUpdate(orderId, client);

      if (!reservation) {
        throw new ApiError(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
      }

      // Idempotencia: ya confirmada -> devolver la misma.
      if (reservation.status === "CONFIRMED") {
        return reservation;
      }

      if (reservation.status !== "RESERVED") {
        throw new ApiError(
          409,
          "RESERVATION_NOT_ACTIVE",
          `The reservation for order ${orderId} is not in RESERVED status.`
        );
      }

      // Mismo orden de locks que en la reserva (anti-deadlock).
      const orderedItems = [...reservation.items].sort((a, b) =>
        a.productId.localeCompare(b.productId)
      );

      for (const item of orderedItems) {
        const exists = await repository.existsInventory(item.productId, client);
        if (!exists) {
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product ${item.productId} not found.`
          );
        }

        // Confirmar = sale del reservado de forma definitiva.
        const ok = await repository.confirmDecrement(item.productId, item.quantity, client);
        if (!ok) {
          throw new ApiError(
            409,
            "INVALID_RESERVED_STOCK",
            `Reserved stock is inconsistent for product ${item.productId}.`
          );
        }
      }

      const transitioned = await repository.updateReservationStatus(
        reservation.reservationId,
        "CONFIRMED",
        client
      );

      if (!transitioned) {
        throw new ApiError(
          409,
          "RESERVATION_NOT_ACTIVE",
          `The reservation for order ${orderId} changed state concurrently.`
        );
      }

      reservation.status = "CONFIRMED";
      reservation.updatedAt = new Date();

      // Outbox: se confirma junto con la transicion de estado.
      await publisher.publishReservationConfirmed(correlationId, reservation, client);

      return reservation;
    });
  }

  async releaseReservation(
    orderId: string,
    correlationId: string
  ): Promise<Reservation> {

    if (!orderId || orderId.trim().length === 0) {
      throw new ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
    }

    return withTransaction(async (client) => {

      // FOR UPDATE: ver confirmReservation (serializa confirm/release
      // concurrentes del mismo pedido).
      const reservation = await repository.getReservationForUpdate(orderId, client);

      if (!reservation) {
        throw new ApiError(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
      }

      // Idempotencia: ya liberada -> devolver la misma.
      if (reservation.status === "RELEASED") {
        return reservation;
      }

      if (reservation.status !== "RESERVED") {
        throw new ApiError(
          409,
          "RESERVATION_NOT_ACTIVE",
          `The reservation for order ${orderId} is not in RESERVED status.`
        );
      }

      // Mismo orden de locks que en la reserva (anti-deadlock).
      const orderedItems = [...reservation.items].sort((a, b) =>
        a.productId.localeCompare(b.productId)
      );

      for (const item of orderedItems) {
        const exists = await repository.existsInventory(item.productId, client);
        if (!exists) {
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product ${item.productId} not found.`
          );
        }

        // Liberar = devolver reservado a disponible.
        const ok = await repository.releaseRestore(item.productId, item.quantity, client);
        if (!ok) {
          throw new ApiError(
            409,
            "INVALID_RESERVED_STOCK",
            `Reserved stock is inconsistent for product ${item.productId}.`
          );
        }
      }

      const transitioned = await repository.updateReservationStatus(
        reservation.reservationId,
        "RELEASED",
        client
      );

      if (!transitioned) {
        throw new ApiError(
          409,
          "RESERVATION_NOT_ACTIVE",
          `The reservation for order ${orderId} changed state concurrently.`
        );
      }

      reservation.status = "RELEASED";
      reservation.updatedAt = new Date();

      // Outbox: routing key InventoryReleased (la que espera G5).
      await publisher.publishReservationReleased(correlationId, reservation, client);

      return reservation;
    });
  }
}

export const reservationService = new ReservationService();
