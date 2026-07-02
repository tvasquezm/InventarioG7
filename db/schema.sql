-- ======================================================
-- Inventory Service (Grupo 7) - Esquema Postgres (Supabase)
-- Fase 3 (E3 Cloud) - migracion del store en memoria a SQL
-- ======================================================
-- Como usar:
--   1. Supabase -> SQL Editor -> New snippet
--   2. Pegar TODO este archivo y Run.
-- Es idempotente: se puede correr varias veces sin romper nada.
--
-- Usa el schema dedicado 'inventario' dentro del proyecto Supabase PROPIO de G7
-- (cada grupo tiene su propia base de datos; ya no se comparte proyecto).
-- ======================================================

CREATE SCHEMA IF NOT EXISTS inventario;

-- ------------------------------------------------------
-- inventory: stock por producto (la verdad del stock)
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.inventory (
    product_id      uuid PRIMARY KEY,
    available_stock integer NOT NULL DEFAULT 0 CHECK (available_stock >= 0),
    reserved_stock  integer NOT NULL DEFAULT 0 CHECK (reserved_stock  >= 0),
    version         integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------
-- reservations: reserva de un pedido
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.reservations (
    reservation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        text NOT NULL,
    status          text NOT NULL DEFAULT 'RESERVED'
                    CHECK (status IN ('RESERVED','CONFIRMED','RELEASED','EXPIRED')),
    idempotency_key uuid NOT NULL UNIQUE,
    expires_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------
-- reservation_items: items de cada reserva (reserva por lote)
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.reservation_items (
    id                       bigserial PRIMARY KEY,
    reservation_id           uuid NOT NULL REFERENCES inventario.reservations(reservation_id),
    product_id               uuid NOT NULL REFERENCES inventario.inventory(product_id),
    quantity                 integer NOT NULL CHECK (quantity > 0),
    available_stock_snapshot integer
);

-- ------------------------------------------------------
-- processed_events: idempotencia de eventos consumidos
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.processed_events (
    event_id        uuid PRIMARY KEY,
    event_type      text NOT NULL,
    processed_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------
-- stock_operations: idempotencia de la carga/ajuste de stock
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.stock_operations (
    idempotency_key uuid PRIMARY KEY,
    product_id      uuid NOT NULL REFERENCES inventario.inventory(product_id),
    operation       text NOT NULL CHECK (operation IN ('SET','ADD')),
    quantity        integer NOT NULL CHECK (quantity >= 0),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------
-- Indices
-- ------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reservations_order
    ON inventario.reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_expires
    ON inventario.reservations(expires_at) WHERE status = 'RESERVED';

-- ======================================================
-- SEED: mismos productos que el mock de Fase 2
-- (uno con 15 unidades, otro con 1 para la prueba de concurrencia)
-- ON CONFLICT: no pisa el stock si ya existe.
-- ======================================================
INSERT INTO inventario.inventory (product_id, available_stock, reserved_stock, version)
VALUES
    ('550e8400-e29b-41d4-a716-446655440000', 15, 0, 1),
    ('660e8400-e29b-41d4-a716-446655440111',  1, 0, 1)
ON CONFLICT (product_id) DO NOTHING;
