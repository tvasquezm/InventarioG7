import crypto from "crypto";
import { Mutex } from "async-mutex";
import { publisher } from "../events/publisher";

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
  correlationId: string; // <-- AÑADIDO: Requerido por el estándar Fase 2
}

export interface ReserveStockResult {
  reservation: Reservation;
  isIdempotentReplay: boolean;
}

// ========================================
// MUTEX GLOBAL DEL DOMINIO
// ========================================

const reservationMutex = new Mutex();

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

    return reservationMutex.runExclusive(async () => {

      const {
        orderId,
        idempotencyKey,
        items,
        ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES,
        correlationId // <-- AÑADIDO
      } = request;

      // ========================================
      // VALIDACIONES BÁSICAS
      // ========================================

      if (!orderId || orderId.trim().length === 0) {
        throw new ApiError(
          400,
          "INVALID_ORDER_ID",
          "orderId is required."
        );
      }

      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new ApiError(
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "idempotencyKey is required."
        );
      }

      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiError(
          400,
          "INVALID_ITEMS",
          "At least one item is required."
        );
      }

      for (const item of items) {
        if (!item.productId || item.productId.trim().length === 0) {
          throw new ApiError(
            400,
            "INVALID_PRODUCT_ID",
            "Each item must include a valid productId."
          );
        }

        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          throw new ApiError(
            400,
            "INVALID_QUANTITY",
            "Each item must include a quantity greater than 0."
          );
        }
      }

      // ========================================
      // IDEMPOTENCIA
      // ========================================

      const existingReservation =
        repository.findReservationByIdempotencyKey(idempotencyKey);

      if (existingReservation) {

        // <-- AÑADIDO: Defensa contra secuestro de idempotencia (Fase 2)
        if (existingReservation.orderId !== orderId) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency-Key already used for a different order."
          );
        }

        return {
          reservation: existingReservation,
          isIdempotentReplay: true
        };
      }

      // ========================================
      // VALIDAR QUE EL orderId NO ESTÉ YA EN USO
      // ========================================

      const reservationByOrderId =
        repository.getReservation(orderId);

      if (reservationByOrderId) {
        throw new ApiError(
          409,
          "ORDER_ALREADY_RESERVED",
          "A reservation already exists for this orderId."
        );
      }

      // ========================================
      // VALIDACIÓN TODO-O-NADA
      // ========================================

      for (const item of items) {
        const inventory = repository.getInventory(item.productId);

        if (!inventory) {
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product ${item.productId} not found.`
          );
        }

        if (inventory.availableStock < item.quantity) {
          
          // <-- AÑADIDO: Avisar al ecosistema del rechazo (Fase 2)
          publisher.publishStockRejected(
            correlationId, 
            { 
              orderId, 
              reason: `Insufficient stock for product ${item.productId}.`,
              items 
            }
          );

          throw new ApiError(
            422,
            "OUT_OF_STOCK",
            `Insufficient stock for product ${item.productId}.`
          );
        }
      }

      // ========================================
      // SI TODAS LAS VALIDACIONES PASAN,
      // RECIÉN AQUÍ APLICAMOS LA RESERVA
      // ========================================

      const now = new Date();

      const expiresAt = new Date(
        now.getTime() + ttlMinutes * 60 * 1000
      );

      for (const item of items) {
        const inventory = repository.getInventory(item.productId)!;

        inventory.availableStock -= item.quantity;
        inventory.reservedStock += item.quantity;
        inventory.version += 1;
        inventory.updatedAt = new Date();

        repository.saveInventory(inventory);
      }

      const reservation: Reservation = {
        reservationId: crypto.randomUUID(),
        orderId,
        idempotencyKey,
        status: "RESERVED",
        items: items.map(item => {
        const inventory = repository.getInventory(item.productId)!;

        return {
          productId: item.productId,
          quantity: item.quantity,
          availableStock: inventory.availableStock
        };
      }),
        expiresAt,
        createdAt: now,
        updatedAt: now
      };

      repository.saveReservation(reservation);
      repository.saveIdempotencyKey(
        idempotencyKey,
        reservation.reservationId
      );

      // <-- MODIFICADO: Inyectar correlationId para auditoría
      publisher.publishReservationCreated(correlationId, reservation);

      return {
        reservation,
        isIdempotentReplay: false
      };
    });
  }

  async confirmReservation(
    orderId: string,
    correlationId: string // <-- AÑADIDO
  ): Promise<Reservation> {

    return reservationMutex.runExclusive(async () => {

      if (!orderId || orderId.trim().length === 0) {
        throw new ApiError(
          400,
          "INVALID_ORDER_ID",
          "orderId is required."
        );
      }

      const reservation = repository.getReservation(orderId);

      if (!reservation) {
        throw new ApiError(
          404,
          "RESERVATION_NOT_FOUND",
          "Reservation not found."
        );
      }

      // Idempotencia: si ya está confirmada, devolver la misma
      if (reservation.status === "CONFIRMED") {
        return reservation;
      }

      // Solo se puede confirmar desde RESERVED
      if (reservation.status !== "RESERVED") {
        throw new ApiError(
          409,
          "RESERVATION_NOT_ACTIVE",
          `The reservation for order ${orderId} is not in RESERVED status.`
        );
      }

      for (const item of reservation.items) {
        const inventory = repository.getInventory(item.productId);

        if (!inventory) {
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product ${item.productId} not found.`
          );
        }

        if (inventory.reservedStock < item.quantity) {
          throw new ApiError(
            409,
            "INVALID_RESERVED_STOCK",
            `Reserved stock is inconsistent for product ${item.productId}.`
          );
        }
      }

      for (const item of reservation.items) {
        const inventory = repository.getInventory(item.productId)!;

        // Confirmar = sale del reservado de forma definitiva
        inventory.reservedStock -= item.quantity;
        inventory.version += 1;
        inventory.updatedAt = new Date();

        repository.saveInventory(inventory);
      }

      reservation.status = "CONFIRMED";
      reservation.updatedAt = new Date();

      repository.saveReservation(reservation);
      
      // <-- MODIFICADO: Inyectar correlationId
      publisher.publishReservationConfirmed(correlationId, reservation);

      return reservation;
    });
  }

  async releaseReservation(
    orderId: string,
    correlationId: string // <-- AÑADIDO
  ): Promise<Reservation> {

    return reservationMutex.runExclusive(async () => {

      if (!orderId || orderId.trim().length === 0) {
        throw new ApiError(
          400,
          "INVALID_ORDER_ID",
          "orderId is required."
        );
      }

      const reservation = repository.getReservation(orderId);

      if (!reservation) {
        throw new ApiError(
          404,
          "RESERVATION_NOT_FOUND",
          "Reservation not found."
        );
      }

      // Idempotencia: si ya está liberada, devolver la misma
      if (reservation.status === "RELEASED") {
        return reservation;
      }

      // Solo se puede liberar desde RESERVED
      if (reservation.status !== "RESERVED") {
        throw new ApiError(
          409,
          "RESERVATION_NOT_ACTIVE",
          `The reservation for order ${orderId} is not in RESERVED status.`
        );
      }

      for (const item of reservation.items) {
        const inventory = repository.getInventory(item.productId);

        if (!inventory) {
          throw new ApiError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product ${item.productId} not found.`
          );
        }

        if (inventory.reservedStock < item.quantity) {
          throw new ApiError(
            409,
            "INVALID_RESERVED_STOCK",
            `Reserved stock is inconsistent for product ${item.productId}.`
          );
        }
      }

      for (const item of reservation.items) {
        const inventory = repository.getInventory(item.productId)!;

        // Liberar = devolver reservado a disponible
        inventory.reservedStock -= item.quantity;
        inventory.availableStock += item.quantity;
        inventory.version += 1;
        inventory.updatedAt = new Date();

        repository.saveInventory(inventory);
      }

      reservation.status = "RELEASED";
      reservation.updatedAt = new Date();

      repository.saveReservation(reservation);
      
      // <-- MODIFICADO: Inyectar correlationId
      publisher.publishReservationReleased(correlationId, reservation);

      return reservation;
    });
  }
}

export const reservationService =
  new ReservationService();