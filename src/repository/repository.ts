// ======================================================
// Repository - Postgres (Supabase) Store
// Grupo 7 - Inventory Service - Fase 3 (E3 Cloud)
// ======================================================

import { pool, Db, DB_SCHEMA } from "../config/database";

// Schema calificado en cada query (no dependemos del search_path).
const S = DB_SCHEMA;

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
  // business_user_id del dueño del pedido (USR-01 de G2); puede faltar.
  userId: string | null;
  // UUID interno de la orden en G5 (llega por su OrderCreated).
  orderUuid: string | null;
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
      `SELECT * FROM ${S}.inventory WHERE product_id = $1`,
      [productId]
    );
    return res.rows[0] ? mapInventory(res.rows[0]) : undefined;
  }

  async existsInventory(
    productId: string,
    db: Db = pool
  ): Promise<boolean> {
    const res = await db.query(
      `SELECT 1 FROM ${S}.inventory WHERE product_id = $1`,
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
      `SELECT * FROM ${S}.inventory
       ORDER BY product_id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows.map(mapInventory);
  }

  async countInventory(db: Db = pool): Promise<number> {
    const res = await db.query(`SELECT COUNT(*)::int AS total FROM ${S}.inventory`);
    return res.rows[0].total;
  }

  async createInventory(
    inventory: Inventory,
    db: Db = pool
  ): Promise<void> {
    await db.query(
      `INSERT INTO ${S}.inventory
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
        ? `UPDATE ${S}.inventory
              SET available_stock = $2,
                  reserved_stock  = 0,
                  version         = version + 1,
                  updated_at      = now()
            WHERE product_id = $1
          RETURNING *`
        : `UPDATE ${S}.inventory
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
      `UPDATE ${S}.inventory
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
      `UPDATE ${S}.inventory
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
      `UPDATE ${S}.inventory
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
         FROM ${S}.reservation_items
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
      updatedAt: r.updated_at,
      userId: r.user_id ?? null,
      orderUuid: r.order_uuid ?? null
    };
  }

  /**
   * Busca por CUALQUIERA de los dos identificadores de orden del
   * ecosistema: el orderNumber ("ORD-...", con el que G5 nos llama por
   * REST) o el UUID interno de la orden en G5 (con el que la orden viaja
   * en el bus). Asi los eventos de pago se resuelven venga el que venga.
   */
  async getReservation(
    orderId: string,
    db: Db = pool
  ): Promise<Reservation | undefined> {
    const res = await db.query(
      `SELECT * FROM ${S}.reservations
        WHERE order_id = $1 OR order_uuid::text = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [orderId]
    );
    return res.rows[0]
      ? this.mapReservation(res.rows[0], db)
      : undefined;
  }

  /**
   * Igual que getReservation pero con FOR UPDATE (lock pesimista de la fila).
   * Se usa dentro de las transacciones de confirmar/liberar: dos peticiones
   * concurrentes sobre el mismo pedido se serializan aqui; la segunda espera
   * el COMMIT de la primera y relee el estado ya actualizado, por lo que no
   * puede confirmar Y liberar (o confirmar dos veces) la misma reserva.
   */
  async getReservationForUpdate(
    orderId: string,
    db: Db
  ): Promise<Reservation | undefined> {
    const res = await db.query(
      `SELECT * FROM ${S}.reservations
        WHERE order_id = $1 OR order_uuid::text = $1
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
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
      `SELECT * FROM ${S}.reservations WHERE idempotency_key = $1`,
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
      `INSERT INTO ${S}.reservations
         (reservation_id, order_id, order_uuid, status, idempotency_key, expires_at, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        reservation.reservationId,
        reservation.orderId,
        reservation.orderUuid,
        reservation.status,
        reservation.idempotencyKey,
        reservation.expiresAt,
        reservation.userId,
        reservation.createdAt,
        reservation.updatedAt
      ]
    );

    for (const item of reservation.items) {
      await db.query(
        `INSERT INTO ${S}.reservation_items
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

  /**
   * Reclama un lote de reservas RESERVED cuyo TTL ya vencio, para el
   * job batch de expiracion. FOR UPDATE SKIP LOCKED: si hay varias
   * instancias del servicio, cada una procesa reservas distintas y un
   * confirm/release concurrente sobre la misma reserva queda serializado.
   * Usa el indice parcial idx_reservations_expires.
   */
  async claimExpiredReservations(
    limit: number,
    db: Db
  ): Promise<Reservation[]> {
    const res = await db.query(
      `SELECT * FROM ${S}.reservations
        WHERE status = 'RESERVED'
          AND expires_at < now()
        ORDER BY expires_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const out: Reservation[] = [];
    for (const row of res.rows) {
      out.push(await this.mapReservation(row, db));
    }
    return out;
  }

  /**
   * Enlaza la reserva con los datos del OrderCreated de G5: el UUID
   * interno de su orden y el userId (business_user_id) del comprador.
   * Busca por reservationId (nuestra PK, viene en su payload) o por
   * orderNumber. COALESCE: no pisa un user_id que ya llego por el reserve.
   * Devuelve false si ninguna reserva calza (orden ajena al inventario).
   */
  async linkOrderReference(
    reservationId: string | null,
    orderNumber: string | null,
    orderUuid: string | null,
    userId: string | null,
    db: Db = pool
  ): Promise<boolean> {
    const res = await db.query(
      `UPDATE ${S}.reservations
          SET order_uuid = COALESCE(order_uuid, $3::uuid),
              user_id    = COALESCE(user_id, $4),
              updated_at = now()
        WHERE ($1::uuid IS NOT NULL AND reservation_id = $1::uuid)
           OR ($2::text IS NOT NULL AND order_id = $2)`,
      [reservationId, orderNumber, orderUuid, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Transicion de estado condicional: solo aplica si la reserva sigue en
   * el estado esperado (defensa en profundidad ademas del FOR UPDATE).
   * Devuelve false si otra transaccion ya cambio el estado.
   */
  async updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    db: Db,
    expectedStatus: ReservationStatus = "RESERVED"
  ): Promise<boolean> {
    const res = await db.query(
      `UPDATE ${S}.reservations
          SET status = $2, updated_at = now()
        WHERE reservation_id = $1
          AND status = $3`,
      [reservationId, status, expectedStatus]
    );
    return (res.rowCount ?? 0) > 0;
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
         FROM ${S}.stock_operations
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
      `INSERT INTO ${S}.stock_operations
         (idempotency_key, product_id, operation, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [idempotencyKey, record.productId, record.operation, record.quantity]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ========================================
  // OUTBOX (publicacion transaccional de eventos)
  // ========================================

  async insertOutboxEvent(
    event: {
      eventId: string;
      eventType: string;
      version: string;
      occurredAt: string;
      correlationId: string;
      payload: unknown;
    },
    routingKey: string,
    db: Db
  ): Promise<void> {
    await db.query(
      `INSERT INTO ${S}.outbox_events
         (event_id, event_type, routing_key, version, correlation_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.eventId,
        event.eventType,
        routingKey,
        event.version,
        event.correlationId ?? null,
        JSON.stringify(event.payload),
        event.occurredAt
      ]
    );
  }

  /**
   * Toma un lote de eventos pendientes con FOR UPDATE SKIP LOCKED:
   * varias instancias del servicio pueden despachar en paralelo sin
   * publicar el mismo evento dos veces.
   */
  async claimPendingOutbox(
    limit: number,
    db: Db
  ): Promise<
    {
      id: number;
      eventId: string;
      eventType: string;
      routingKey: string;
      version: string;
      correlationId: string | null;
      payload: unknown;
      occurredAt: Date;
    }[]
  > {
    const res = await db.query(
      `SELECT * FROM ${S}.outbox_events
        WHERE published_at IS NULL
        ORDER BY id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      eventId: r.event_id,
      eventType: r.event_type,
      routingKey: r.routing_key,
      version: r.version,
      correlationId: r.correlation_id,
      payload: r.payload,
      occurredAt: r.occurred_at
    }));
  }

  async markOutboxPublished(id: number, db: Db): Promise<void> {
    await db.query(
      `UPDATE ${S}.outbox_events
          SET published_at = now()
        WHERE id = $1`,
      [id]
    );
  }

  // ========================================
  // EVENTOS (idempotencia de consumo)
  // ========================================

  async hasProcessedEvent(
    eventId: string,
    db: Db = pool
  ): Promise<boolean> {
    const res = await db.query(
      `SELECT 1 FROM ${S}.processed_events WHERE event_id = $1`,
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
      `INSERT INTO ${S}.processed_events (event_id, event_type)
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
