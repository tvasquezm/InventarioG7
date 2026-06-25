"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reservationService = exports.ReservationService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const async_mutex_1 = require("async-mutex");
const publisher_1 = require("../events/publisher");
const repository_1 = require("../repository/repository");
const error_middleware_1 = require("../middlewares/error.middleware");
// ========================================
// MUTEX GLOBAL DEL DOMINIO
// ========================================
const reservationMutex = new async_mutex_1.Mutex();
// ========================================
// CONFIG
// ========================================
const DEFAULT_RESERVATION_TTL_MINUTES = 15;
// ========================================
// SERVICE
// ========================================
class ReservationService {
    async reserveStock(request) {
        return reservationMutex.runExclusive(async () => {
            const { orderId, idempotencyKey, items, ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES, correlationId // <-- AÑADIDO
             } = request;
            // ========================================
            // VALIDACIONES BÁSICAS
            // ========================================
            if (!orderId || orderId.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
            }
            if (!idempotencyKey || idempotencyKey.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_IDEMPOTENCY_KEY", "idempotencyKey is required.");
            }
            if (!Array.isArray(items) || items.length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_ITEMS", "At least one item is required.");
            }
            for (const item of items) {
                if (!item.productId || item.productId.trim().length === 0) {
                    throw new error_middleware_1.ApiError(400, "INVALID_PRODUCT_ID", "Each item must include a valid productId.");
                }
                if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
                    throw new error_middleware_1.ApiError(400, "INVALID_QUANTITY", "Each item must include a quantity greater than 0.");
                }
            }
            // ========================================
            // IDEMPOTENCIA
            // ========================================
            const existingReservation = repository_1.repository.findReservationByIdempotencyKey(idempotencyKey);
            if (existingReservation) {
                // <-- AÑADIDO: Defensa contra secuestro de idempotencia (Fase 2)
                if (existingReservation.orderId !== orderId) {
                    throw new error_middleware_1.ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key already used for a different order.");
                }
                return {
                    reservation: existingReservation,
                    isIdempotentReplay: true
                };
            }
            // ========================================
            // VALIDAR QUE EL orderId NO ESTÉ YA EN USO
            // ========================================
            const reservationByOrderId = repository_1.repository.getReservation(orderId);
            if (reservationByOrderId) {
                throw new error_middleware_1.ApiError(409, "ORDER_ALREADY_RESERVED", "A reservation already exists for this orderId.");
            }
            // ========================================
            // VALIDACIÓN TODO-O-NADA
            // ========================================
            for (const item of items) {
                const inventory = repository_1.repository.getInventory(item.productId);
                if (!inventory) {
                    throw new error_middleware_1.ApiError(404, "PRODUCT_NOT_FOUND", `Product ${item.productId} not found.`);
                }
                if (inventory.availableStock < item.quantity) {
                    // <-- AÑADIDO: Avisar al ecosistema del rechazo (Fase 2)
                    publisher_1.publisher.publishStockRejected(correlationId, {
                        orderId,
                        reason: `Insufficient stock for product ${item.productId}.`,
                        items
                    });
                    throw new error_middleware_1.ApiError(422, "OUT_OF_STOCK", `Insufficient stock for product ${item.productId}.`);
                }
            }
            // ========================================
            // SI TODAS LAS VALIDACIONES PASAN,
            // RECIÉN AQUÍ APLICAMOS LA RESERVA
            // ========================================
            const now = new Date();
            const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
            for (const item of items) {
                const inventory = repository_1.repository.getInventory(item.productId);
                inventory.availableStock -= item.quantity;
                inventory.reservedStock += item.quantity;
                inventory.version += 1;
                inventory.updatedAt = new Date();
                repository_1.repository.saveInventory(inventory);
            }
            const reservation = {
                reservationId: crypto_1.default.randomUUID(),
                orderId,
                idempotencyKey,
                status: "RESERVED",
                items: items.map(item => {
                    const inventory = repository_1.repository.getInventory(item.productId);
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
            repository_1.repository.saveReservation(reservation);
            repository_1.repository.saveIdempotencyKey(idempotencyKey, reservation.reservationId);
            // <-- MODIFICADO: Inyectar correlationId para auditoría
            publisher_1.publisher.publishReservationCreated(correlationId, reservation);
            return {
                reservation,
                isIdempotentReplay: false
            };
        });
    }
    async confirmReservation(orderId, correlationId // <-- AÑADIDO
    ) {
        return reservationMutex.runExclusive(async () => {
            if (!orderId || orderId.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
            }
            const reservation = repository_1.repository.getReservation(orderId);
            if (!reservation) {
                throw new error_middleware_1.ApiError(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
            }
            // Idempotencia: si ya está confirmada, devolver la misma
            if (reservation.status === "CONFIRMED") {
                return reservation;
            }
            // Solo se puede confirmar desde RESERVED
            if (reservation.status !== "RESERVED") {
                throw new error_middleware_1.ApiError(409, "RESERVATION_NOT_ACTIVE", `The reservation for order ${orderId} is not in RESERVED status.`);
            }
            for (const item of reservation.items) {
                const inventory = repository_1.repository.getInventory(item.productId);
                if (!inventory) {
                    throw new error_middleware_1.ApiError(404, "PRODUCT_NOT_FOUND", `Product ${item.productId} not found.`);
                }
                if (inventory.reservedStock < item.quantity) {
                    throw new error_middleware_1.ApiError(409, "INVALID_RESERVED_STOCK", `Reserved stock is inconsistent for product ${item.productId}.`);
                }
            }
            for (const item of reservation.items) {
                const inventory = repository_1.repository.getInventory(item.productId);
                // Confirmar = sale del reservado de forma definitiva
                inventory.reservedStock -= item.quantity;
                inventory.version += 1;
                inventory.updatedAt = new Date();
                repository_1.repository.saveInventory(inventory);
            }
            reservation.status = "CONFIRMED";
            reservation.updatedAt = new Date();
            repository_1.repository.saveReservation(reservation);
            // <-- MODIFICADO: Inyectar correlationId
            publisher_1.publisher.publishReservationConfirmed(correlationId, reservation);
            return reservation;
        });
    }
    async releaseReservation(orderId, correlationId // <-- AÑADIDO
    ) {
        return reservationMutex.runExclusive(async () => {
            if (!orderId || orderId.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
            }
            const reservation = repository_1.repository.getReservation(orderId);
            if (!reservation) {
                throw new error_middleware_1.ApiError(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
            }
            // Idempotencia: si ya está liberada, devolver la misma
            if (reservation.status === "RELEASED") {
                return reservation;
            }
            // Solo se puede liberar desde RESERVED
            if (reservation.status !== "RESERVED") {
                throw new error_middleware_1.ApiError(409, "RESERVATION_NOT_ACTIVE", `The reservation for order ${orderId} is not in RESERVED status.`);
            }
            for (const item of reservation.items) {
                const inventory = repository_1.repository.getInventory(item.productId);
                if (!inventory) {
                    throw new error_middleware_1.ApiError(404, "PRODUCT_NOT_FOUND", `Product ${item.productId} not found.`);
                }
                if (inventory.reservedStock < item.quantity) {
                    throw new error_middleware_1.ApiError(409, "INVALID_RESERVED_STOCK", `Reserved stock is inconsistent for product ${item.productId}.`);
                }
            }
            for (const item of reservation.items) {
                const inventory = repository_1.repository.getInventory(item.productId);
                // Liberar = devolver reservado a disponible
                inventory.reservedStock -= item.quantity;
                inventory.availableStock += item.quantity;
                inventory.version += 1;
                inventory.updatedAt = new Date();
                repository_1.repository.saveInventory(inventory);
            }
            reservation.status = "RELEASED";
            reservation.updatedAt = new Date();
            repository_1.repository.saveReservation(reservation);
            // <-- MODIFICADO: Inyectar correlationId
            publisher_1.publisher.publishReservationReleased(correlationId, reservation);
            return reservation;
        });
    }
}
exports.ReservationService = ReservationService;
exports.reservationService = new ReservationService();
//# sourceMappingURL=reservations.js.map