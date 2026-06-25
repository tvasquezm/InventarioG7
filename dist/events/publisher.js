"use strict";
// ======================================================
// Publisher - Mock Event Publisher
// Grupo 7 - Inventory Service
// ======================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publisher = exports.Publisher = void 0;
const crypto_1 = __importDefault(require("crypto"));
class Publisher {
    publish(event) {
        console.log("======================================");
        console.log(` 📦 Inventory Event Published: ${event.eventType}`);
        console.log("======================================");
        console.log(JSON.stringify(event, null, 2));
        console.log("======================================");
    }
    // <-- MODIFICADO: Recibe correlationId
    publishReservationCreated(correlationId, reservation) {
        this.publish({
            eventId: crypto_1.default.randomUUID(),
            eventType: "inventory.reserved",
            occurredAt: new Date().toISOString(),
            correlationId,
            payload: {
                reservationId: reservation.reservationId,
                orderId: reservation.orderId,
                status: reservation.status,
                items: reservation.items,
                expiresAt: reservation.expiresAt
            }
        });
    }
    // <-- MODIFICADO: Recibe correlationId
    publishReservationConfirmed(correlationId, reservation) {
        this.publish({
            eventId: crypto_1.default.randomUUID(),
            eventType: "inventory.confirmed",
            occurredAt: new Date().toISOString(),
            correlationId,
            payload: {
                reservationId: reservation.reservationId,
                orderId: reservation.orderId,
                status: reservation.status,
                items: reservation.items
            }
        });
    }
    // <-- MODIFICADO: Recibe correlationId
    publishReservationReleased(correlationId, reservation) {
        this.publish({
            eventId: crypto_1.default.randomUUID(),
            eventType: "inventory.released",
            occurredAt: new Date().toISOString(),
            correlationId,
            payload: {
                reservationId: reservation.reservationId,
                orderId: reservation.orderId,
                status: reservation.status,
                items: reservation.items
            }
        });
    }
    // <-- AÑADIDO: Evento obligatorio de Fase 2 para cancelar ordenes sin stock
    publishStockRejected(correlationId, payload) {
        this.publish({
            eventId: crypto_1.default.randomUUID(),
            eventType: "inventory.stock_rejected",
            occurredAt: new Date().toISOString(),
            correlationId,
            payload
        });
    }
    // <-- AÑADIDO: Evento obligatorio de Fase 2 para cuando se repone stock manual
    publishStockChanged(productId, inventoryResponse, correlationId) {
        this.publish({
            eventId: crypto_1.default.randomUUID(),
            eventType: "inventory.stock_changed",
            occurredAt: new Date().toISOString(),
            correlationId,
            payload: {
                productId,
                availableStock: inventoryResponse.availableStock,
                reservedStock: inventoryResponse.reservedStock
            }
        });
    }
}
exports.Publisher = Publisher;
exports.publisher = new Publisher();
//# sourceMappingURL=publisher.js.map