// ======================================================
// Repository - In Memory Store
// Grupo 7 - Inventory Service
// ======================================================

export interface Inventory {
  productId: string;
  availableStock: number;
  reservedStock: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReservationItem {
  productId: string;
  quantity: number;
  availableStock: number;
}

export type ReservationStatus =
  | "RESERVED"
  | "CONFIRMED"
  | "RELEASED"
  | "EXPIRED";

export interface Reservation {
  reservationId: string;
  orderId: string;
  idempotencyKey: string;
  status: ReservationStatus;
  items: ReservationItem[];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryView {
  productId: string;
  availableStock: number;
  reservedStock: number;
  totalStock: number;
  virtualStock: number;
}

export interface StockIdempotencyRecord {
  productId: string;
  operation: "SET" | "ADD";
  quantity: number;
  response: InventoryView;
}

class Repository {

  // ========================================
  // STORE EN MEMORIA
  // ========================================

  private inventoryStore = new Map<string, Inventory>();

  private reservationStore = new Map<string, Reservation>();

  private idempotencyStore = new Map<string, string>();

  private processedEvents = new Set<string>();

  private stockIdempotency = new Map<string, StockIdempotencyRecord>();

  // ========================================
  // INVENTORY
  // ========================================

  createInventory(inventory: Inventory): void {
    this.inventoryStore.set(inventory.productId, inventory);
  }

  saveInventory(inventory: Inventory): void {
    this.inventoryStore.set(inventory.productId, inventory);
  }

  getInventory(productId: string): Inventory | undefined {
    return this.inventoryStore.get(productId);
  }

  existsInventory(productId: string): boolean {
    return this.inventoryStore.has(productId);
  }

  listInventory(): Inventory[] {
    return Array.from(this.inventoryStore.values());
  }

  deleteInventory(productId: string): boolean {
    return this.inventoryStore.delete(productId);
  }

  findStockIdempotencyKey(
  idempotencyKey: string
): StockIdempotencyRecord | undefined {
  return this.stockIdempotency.get(idempotencyKey);
}

saveStockIdempotencyKey(
  idempotencyKey: string,
  record: StockIdempotencyRecord
): void {
  this.stockIdempotency.set(idempotencyKey, record);
}

  updateStock(
  productId: string,
  quantity: number,
  operation: "SET" | "ADD"
): Inventory {

  const inventory = this.inventoryStore.get(productId);

  if (!inventory) {
    throw new Error("INVENTORY_NOT_FOUND");
  }

  if (operation === "SET") {
    inventory.availableStock = quantity;
    inventory.reservedStock = 0;
  } else {
    inventory.availableStock += quantity;
  }

  inventory.version += 1;
  inventory.updatedAt = new Date();

  this.inventoryStore.set(productId, inventory);

  return inventory;
}

  // ========================================
  // RESERVATIONS
  // ========================================

  saveReservation(reservation: Reservation): void {
    this.reservationStore.set(reservation.orderId, reservation);
  }

  getReservation(orderId: string): Reservation | undefined {
    return this.reservationStore.get(orderId);
  }

  listReservations(): Reservation[] {
    return Array.from(this.reservationStore.values());
  }

  deleteReservation(orderId: string): boolean {
    return this.reservationStore.delete(orderId);
  }

  findReservationByReservationId(
  reservationId: string
): Reservation | undefined {

  return Array
    .from(this.reservationStore.values())
    .find(
      reservation =>
        reservation.reservationId === reservationId
    );

}

findReservationByIdempotencyKey(
  idempotencyKey: string
): Reservation | undefined {

  const reservationId =
    this.idempotencyStore.get(idempotencyKey);

  if (!reservationId) {
    return undefined;
  }

  return this.findReservationByReservationId(
    reservationId
  );

}
  // ========================================
  // IDEMPOTENCY
  // ========================================

  saveIdempotencyKey(key: string, reservationId: string): void {
    this.idempotencyStore.set(key, reservationId);
  }

  getReservationIdByIdempotencyKey(
    key: string
  ): string | undefined {
    return this.idempotencyStore.get(key);
  }


  // ========================================
  // EVENTOS
  // ========================================

  hasProcessedEvent(eventId: string): boolean {
    return this.processedEvents.has(eventId);
  }

  markProcessedEvent(eventId: string): void {
    this.processedEvents.add(eventId);
  }


  // ========================================
  // VISTA
  // ========================================

  toInventoryView(
    inventory: Inventory
  ): InventoryView {

    const totalStock =
      inventory.availableStock +
      inventory.reservedStock;

    return {

      productId: inventory.productId,

      availableStock: inventory.availableStock,

      reservedStock: inventory.reservedStock,

      totalStock,

      // disponible para vender

      virtualStock:
        inventory.availableStock

    };

  }

}

export const repository = new Repository();