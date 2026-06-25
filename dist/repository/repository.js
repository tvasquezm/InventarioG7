"use strict";
// ======================================================
// Repository - In Memory Store
// Grupo 7 - Inventory Service
// ======================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.repository = void 0;
class Repository {
    // ========================================
    // STORE EN MEMORIA
    // ========================================
    inventoryStore = new Map();
    reservationStore = new Map();
    idempotencyStore = new Map();
    processedEvents = new Set();
    // ========================================
    // INVENTORY
    // ========================================
    createInventory(inventory) {
        this.inventoryStore.set(inventory.productId, inventory);
    }
    saveInventory(inventory) {
        this.inventoryStore.set(inventory.productId, inventory);
    }
    getInventory(productId) {
        return this.inventoryStore.get(productId);
    }
    existsInventory(productId) {
        return this.inventoryStore.has(productId);
    }
    listInventory() {
        return Array.from(this.inventoryStore.values());
    }
    deleteInventory(productId) {
        return this.inventoryStore.delete(productId);
    }
    // ========================================
    // RESERVATIONS
    // ========================================
    saveReservation(reservation) {
        this.reservationStore.set(reservation.orderId, reservation);
    }
    getReservation(orderId) {
        return this.reservationStore.get(orderId);
    }
    listReservations() {
        return Array.from(this.reservationStore.values());
    }
    deleteReservation(orderId) {
        return this.reservationStore.delete(orderId);
    }
    // ========================================
    // IDEMPOTENCY
    // ========================================
    saveIdempotencyKey(key, reservationId) {
        this.idempotencyStore.set(key, reservationId);
    }
    getReservationIdByIdempotencyKey(key) {
        return this.idempotencyStore.get(key);
    }
    // ========================================
    // EVENTOS
    // ========================================
    hasProcessedEvent(eventId) {
        return this.processedEvents.has(eventId);
    }
    markProcessedEvent(eventId) {
        this.processedEvents.add(eventId);
    }
    // ========================================
    // VISTA
    // ========================================
    toInventoryView(inventory) {
        const totalStock = inventory.availableStock +
            inventory.reservedStock;
        return {
            productId: inventory.productId,
            availableStock: inventory.availableStock,
            reservedStock: inventory.reservedStock,
            totalStock,
            // disponible para vender
            virtualStock: inventory.availableStock
        };
    }
}
exports.repository = new Repository();
//# sourceMappingURL=repository.js.map