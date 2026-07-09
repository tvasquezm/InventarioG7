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
    -- E4: business_user_id del dueño del pedido (formato USR-01 de G2).
    -- Llega en el body del reserve (v1.6) o del OrderCreated de G5.
    -- Lo requiere G9 en el payload de StockRejected v1.1.
    user_id         text,
    -- E4: UUID interno de la orden en G5 (su OrderCreated lo trae).
    -- G5 nos llama por orderNumber pero en el bus la orden viaja como
    -- UUID: con ambos, los eventos de pago se resuelven venga el que venga.
    order_uuid      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Migracion idempotente para BDs creadas antes de E4.
ALTER TABLE inventario.reservations ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE inventario.reservations ADD COLUMN IF NOT EXISTS order_uuid uuid;
CREATE INDEX IF NOT EXISTS idx_reservations_order_uuid
    ON inventario.reservations(order_uuid);

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
-- outbox_events: patron Outbox (Fase 4 - eventos reales)
-- El evento se inserta EN LA MISMA transaccion que cambia el
-- stock; un dispatcher lo publica despues a RabbitMQ (exchange
-- compartido 'fishmarket') y marca published_at. Garantiza que
-- no se publican eventos de transacciones que hicieron ROLLBACK
-- (entrega al menos una vez; los consumidores deduplican por event_id).
-- ------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.outbox_events (
    id              bigserial PRIMARY KEY,
    event_id        uuid NOT NULL UNIQUE,
    event_type      text NOT NULL,
    routing_key     text NOT NULL,
    version         text NOT NULL DEFAULT '1.0',
    correlation_id  text,
    payload         jsonb NOT NULL,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON inventario.outbox_events(id) WHERE published_at IS NULL;

-- ------------------------------------------------------
-- Indices
-- ------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reservations_order
    ON inventario.reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_expires
    ON inventario.reservations(expires_at) WHERE status = 'RESERVED';

-- Un pedido no puede tener mas de UNA reserva activa a la vez.
-- Guarda real contra la carrera de dos POST /inventory/reserve concurrentes
-- con el mismo orderId y distinta Idempotency-Key: el chequeo en la app es
-- check-then-insert (no atomico); este indice hace que el INSERT perdedor
-- falle (23505 -> 409 DUPLICATED_REQUEST) y su transaccion no toque stock.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_active_order
    ON inventario.reservations(order_id) WHERE status IN ('RESERVED','CONFIRMED');

-- ======================================================
-- SEED 1: productos de prueba del mock de Fase 2
-- (uno con 15 unidades, otro con 1 para la prueba de concurrencia;
--  los usa la coleccion Postman y la prueba de concurrencia)
-- ON CONFLICT: no pisa el stock si ya existe.
-- ======================================================
INSERT INTO inventario.inventory (product_id, available_stock, reserved_stock, version)
VALUES
    ('550e8400-e29b-41d4-a716-446655440000', 15, 0, 1),
    ('660e8400-e29b-41d4-a716-446655440111',  1, 0, 1)
ON CONFLICT (product_id) DO NOTHING;

-- ======================================================
-- SEED 2: UUIDs REALES del catalogo de G3 (mock desplegado,
-- GET https://catalog-api-cm1l.onrender.com/api/v1/products, 2026-07-01).
-- El stock inicial coincide con el stock_visible del catalogo para que
-- catalogo e inventario partan coherentes (luego la verdad es esta BD y
-- el stockVisible de G3 se refresca con nuestro evento StockChanged).
-- Se excluyen las entradas de prueba del catalogo ("Test" y duplicados).
-- ON CONFLICT: no pisa el stock si ya existe.
-- ======================================================
INSERT INTO inventario.inventory (product_id, available_stock, reserved_stock, version)
VALUES
    ('0e319c09-7aa8-4162-b0dd-7f8e6f5a610a', 15, 0, 1), -- Cana Shimano Sedona 2.10m
    ('1398de9b-c483-4ad1-805a-619e78453963', 22, 0, 1), -- Cana Daiwa Exceler 1.80m
    ('b33e919f-4f5c-4921-b552-fbe8a5c9f0ee',  8, 0, 1), -- Carrete Penn Battle III 3000
    ('89d2d1f4-b7de-4734-8e24-f6169c8c2a8a', 30, 0, 1), -- Carrete Shimano Sienna 2500
    ('24d57656-0416-4cb1-80e2-475574ac3234', 42, 0, 1), -- Senuelo Rapala X-Rap 10cm
    ('6e334f56-66c4-4e2c-8e0b-e0f981d3c80a', 60, 0, 1), -- Linea Berkley Trilene XL 0.30mm
    ('90cbdee2-a51e-43e5-acb6-dd4ff75ac9fc', 12, 0, 1), -- Carrete Daiwa Revros LT 2500
    ('ae9067e3-069d-4af4-b4ad-ddfaf555fc32', 35, 0, 1), -- Senuelo Yo-Zuri Crystal Minnow
    ('25833647-f602-487e-b136-d8fac6a641f7', 40, 0, 1), -- Senuelo Storm Gomoku
    ('a22fccb5-d3e4-4e4e-82da-2a46c1188826', 28, 0, 1), -- Linea PowerPro Trenzada 20lb
    ('1f55c15e-2b28-4228-8cba-93014823e81d', 85, 0, 1), -- Anzuelos Mustad 2/0
    ('050a226a-a892-4689-82c2-98f4be6b66bb', 18, 0, 1)  -- Cana Okuma Celilo 2.40m
ON CONFLICT (product_id) DO NOTHING;
