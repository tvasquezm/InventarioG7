// ======================================================
// Repository - Postgres (Supabase) Store
// Grupo 7 - Inventory Service - Fase 3 (E3 Cloud)
// ======================================================

import { pool, Db } from "../config/database";

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

export interface StockOperationRecord {
  productId: string;
  operation: "SET" | "ADD";
  quantity: number;
}

// ======================================================
// Mapeadores fila (snake_case) -> objeto (camelCase)
// ======================================================

function mapInventory(r: any): Inventory {
  return {
    productId: r.product_id,
    availableStock: r.available_stock,
    reservedStock: r.reserved_stock,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function mapReservationItem(r: any): ReservationItem {
  return {
    productId: r.product_id,
    quantity: r.quantity,
    availableStock: r.available_stock_snapshot
  };
}

class Repository {

  // ========================================
  // INVENTORY
  // ========================================

  async getInventory(
    productId: string,
    db: Db = pool
  ): Promise<Inventory | undefined> {
    const res = await db.query(
      `SELECT * FROM inventory WHERE product_id = $1`,
      [productId]
    );
    return res.rows[0] ? mapInventory(res.rows[0]) : undefined;
  }

  async existsInventory(
    productId: string,
    db: Db = pool
  ): Promise<boolean> {
    const res = await db.query(
      `SELECT 1 FROM inventory WHERE product_id = $1`,
      [productId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listInventoryPage(
    limit: number,
    offset: number,
    db: Db = pool
  ): Promise<Inventory[]> {
    const res = await db.query(
      `SELECT * FROM inventory
       ORDER BY product_id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows.map(mapInventory);
  }

  async countInventory(db: Db = pool): Promise<number> {
    const res = await db.query(`SELECT COUNT(*)::int AS total FROM inventory`);
    return res.rows[0].total;
  }

  async createInventory(
    inventory: Inventory,
    db: Db = pool
  ): Promise<void> {
    await db.query(
      `INSERT INTO inventory
         (product_id, available_stock, reserved_stock, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (product_id) DO NOTHING`,
      [
        inventory.productId,
        inventory.availableStock,
        inventory.reservedStock,
        inventory.version,
        inventory.createdAt,
        inventory.updatedAt
      ]
    );
  }

  /**
   * POST /inventory/:productId/stock — SET o ADD.
   * Devuelve el inventario actualizado.
   */
  async updateStock(
    productId: string,
    quantity: number,
    operation: "SET" | "ADD",
    db: Db = pool
  ): Promise<Inventory> {

    const sql =
      operation === "SET"
        ? `UPDATE inventory
              SET available_stock = $2,
                  reserved_stock  = 0,
                  version         = version + 1,
                  updated_at      = now()
            WHERE product_id = $1
          RETURNING *`
        : `UPDATE inventory
              SET available_stock = available_stock + $2,
                  version         = version + 1,
                  updated_at      = now()
            WHERE product_id = $1
          RETURNING *`;

    const res = await db.query(sql, [productId, quantity]);

    if (res.rowCount === 0) {
      throw new Error("INVENTORY_NOT_FOUND");
    }

    return mapInventory(res.rows[0]);
  }

  /**
   * Descuento atomico para RESERVAR (control de concurrencia real).
   * UPDATE condicional: solo descuenta si hay stock suficiente.
   * Devuelve el available_stock resultante, o null si no habia stock
   * (rowCount = 0 => otra transaccion gano la ultima unidad).
   */
  async reserveDecrement(
    productId: string,
    quantity: number,
    db: Db
  ): Promise<number | null> {
    const res = await db.query(
      `UPDATE inventory
          SET available_stock = available_stock - $2,
              reserved_stock  = reserved_stock  + $2,
              version         = version + 1,
              updated_at      = now()
        WHERE product_id = $1
          AND available_stock >= $2
      RETURNING available_stock`,
      [productId, quantity]
    );
    return res.rowCount && res.rowCount > 0
      ? res.rows[0].available_stock
      : null;
  }

  /**
   * CONFIRMAR: el stock reservado sale definitivamente (ya se vendio).
   */
  async confirmDecrement(
    productId: string,
    quantity: number,
    db: Db
  ): Promise<boolean> {
    const res = await db.query(
      `UPDATE inventory
          SET reserved_stock = reserved_stock - $2,
              version        = version + 1,
              updated_at     = now()
        WHERE product_id = $1
          AND reserved_stock >= $2
      RETURNING reserved_stock`,
      [productId, quantity]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * LIBERAR: el stock reservado vuelve a estar disponible.
   */
  async releaseRestore(
    productId: string,
    quantity: number,
    db: Db
  ): Promise<boolean> {
    const res = await db.query(
      `UPDATE inventory
          SET reserved_stock  = reserved_stock  - $2,
              available_stock = available_stock + $2,
              version         = version + 1,
              updated_at      = now()
        WHERE product_id = $1
          AND reserved_stock >= $2
      RETURNING available_stock`,
      [productId, quantity]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ========================================
  // RESERVATIONS
  // ========================================

  private async loadItems(
    reservationId: string,
    db: Db
  ): Promise<ReservationItem[]> {
    const res = await db.query(
      `SELECT product_id, quantity, available_stock_snapshot
         FROM reservation_items
        WHERE reservation_id = $1`,
      [reservationId]
    );
    return res.rows.map(mapReservationItem);
  }

  private async mapReservation(
    r: any,
    db: Db
  ): Promise<Reservation> {
    return {
      reservationId: r.reservation_id,
      orderId: r.order_id,
      idempotencyKey: r.idempotency_key,
      status: r.status,
      items: await this.loadItems(r.reservation_id, db),
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  async getReservation(
    orderId: string,
    db: Db = pool
  ): Promise<Reservation | undefined> {
    const res = await db.query(
      `SELECT * FROM reservations
        WHERE order_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [orderId]
    );
    return res.rows[0]
      ? this.mapReservation(res.rows[0], db)
      : undefined;
  }

  async findReservationByIdempotencyKey(
    idempotencyKey: string,
    db: Db = pool
  ): Promise<Reservation | undefined> {
    const res = await db.query(
      `SELECT * FROM reservations WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    return res.rows[0]
      ? this.mapReservation(res.rows[0], db)
      : undefined;
  }

  /**
   * Inserta la reserva y sus items (dentro de la transaccion de reserva).
   */
  async insertReservation(
    reservation: Reservation,
    db: Db
  ): Promise<void> {
    await db.query(
      `INSERT INTO reservations
         (reservation_id, order_id, status, idempotency_key, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        reservation.reservationId,
        reservation.orderId,
        reservation.status,
        reservation.idempotencyKey,
        reservation.expiresAt,
        reservation.createdAt,
        reservation.updatedAt
      ]
    );

    for (const item of reservation.items) {
      await db.query(
        `INSERT INTO reservation_items
           (reservation_id, product_id, quantity, available_stock_snapshot)
         VALUES ($1, $2, $3, $4)`,
        [
          reservation.reservationId,
          item.productId,
          item.quantity,
          item.availableStock
        ]
      );
    }
  }

  async updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    db: Db
  ): Promise<void> {
    await db.query(
      `UPDATE reservations
          SET status = $2, updated_at = now()
        WHERE reservation_id = $1`,
      [reservationId, status]
    );
  }

  // ========================================
  // IDEMPOTENCIA DE STOCK (POST .../stock)
  // ========================================

  async findStockOperation(
    idempotencyKey: string,
    db: Db = pool
  ): Promise<StockOperationRecord | undefined> {
    const res = await db.query(
      `SELECT product_id, operation, quantity
         FROM stock_operations
        WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    if (!res.rows[0]) return undefined;
    return {
      productId: res.rows[0].product_id,
      operation: res.rows[0].operation,
      quantity: res.rows[0].quantity
    };
  }

  /**
   * Inserta el registro de idempotencia de stock.
   * Devuelve true si inserto, false si la clave ya existia (replay).
   * El INSERT con PK serializa peticiones concurrentes con la misma clave.
   */
  async saveStockOperation(
    idempotencyKey: string,
    record: StockOperationRecord,
    db: Db = pool
  ): Promise<boolean> {
    const res = await db.query(
      `INSERT INTO stock_operations
         (idempotency_key, product_id, operation, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [idempotencyKey, record.productId, record.operation, record.quantity]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ========================================
  // EVENTOS (idempotencia de consumo)
  // ========================================

  async hasProcessedEvent(
    eventId: string,
    db: Db = pool
  ): Promise<boolean> {
    const res = await db.query(
      `SELECT 1 FROM processed_events WHERE event_id = $1`,
      [eventId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markProcessedEvent(
    eventId: string,
    eventType: string = "unknown",
    db: Db = pool
  ): Promise<void> {
    await db.query(
      `INSERT INTO processed_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, eventType]
    );
  }

  // ========================================
  // VISTA (pura, sin BD)
  // ========================================

  toInventoryView(inventory: Inventory): InventoryView {
    const totalStock =
      inventory.availableStock + inventory.reservedStock;

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

export const repository = new Repository();
