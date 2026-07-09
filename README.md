# 📦 Grupo 7 - Microservicio de Inventario y Concurrencia

Este repositorio contiene el **Servicio de Inventario (Inventory Service)** perteneciente al ecosistema distribuido del proyecto **Mini Marketplace Cloud**. 

Nuestro servicio es el responsable absoluto de mantener la verdad sobre el stock de los productos. Gestiona la disponibilidad, reserva temporal de artículos durante el proceso de compra (checkout) y la confirmación o liberación definitiva del inventario, garantizando la consistencia de los datos en entornos de alta concurrencia.

---

## 🏗️ Evolución del Proyecto

### 📌 Fase 1: Diseño, Contratos y Modelado
Durante la primera etapa del proyecto nos enfocamos en definir las reglas del juego y cómo nuestro microservicio se comunicaría con el resto del ecosistema (especialmente con el Grupo 5 - Órdenes). En esta fase entregamos:
* **Diseño del API REST:** Creación del contrato OpenAPI (`contrato-REST-inventario.yaml`).
* **Modelo de Datos:** Definición de entidades clave (Product, Inventory, Reservation) en `modelo-de-datos.md`.
* **Definición de Eventos:** Estructuración de los mensajes asíncronos que nuestro servicio emitirá (`grupo7-inventario-eventos.md`).
* **Matriz de Dependencias y Coordinación:** Alineación de flujos y casos de uso transaccionales.

### 🚀 Fase 2: Implementación Mock y Lógica Core
En esta fase implementamos el contrato definido en la Fase 1 con un servidor funcional (Mock), con la **lógica de negocio y las validaciones definitivas**. La persistencia era en memoria (Maps/Sets) y el control de concurrencia se hacía con `async-mutex`.
* **Protección contra Race Conditions:** bloqueos (Mutex) para serializar las dobles reservas.
* **Idempotencia Transaccional:** uso estricto del header `Idempotency-Key`.
* **Trazabilidad (Correlation):** propagación de `X-Correlation-Id` en todos los flujos.
* **Mock Event Publisher:** simulación de un bus de eventos publicando en consola los eventos del dominio.

### ☁️ Fase 3: Cloud y Persistencia Real (Estado Actual)
Migramos la persistencia en memoria a **Supabase Postgres** (SQL relacional), manteniendo el mismo contrato y comportamiento. El cambio clave es el **control de concurrencia**: pasamos del `async-mutex` (que solo protege dentro de un proceso) a una **transacción de base de datos con `UPDATE ... WHERE available_stock >= qty`**, que serializa las reservas a nivel de fila. Esto resiste el **escalamiento horizontal**: aunque Render levante varias instancias, el lock vive en la BD y no hay sobreventa.
* **Persistencia SQL:** las 5 tablas del modelo de datos en Postgres (`db/schema.sql`), schema dedicado `inventario` (en el proyecto Supabase **propio de G7**: cada grupo tiene su propia base de datos).
* **Concurrencia real:** reserva todo-o-nada dentro de `BEGIN/COMMIT`; el `UPDATE` condicional descuenta solo si hay stock (si afecta 0 filas → `422 OUT_OF_STOCK`).
* **Idempotencia persistente:** las claves de idempotencia (reservas y operaciones de stock) y los eventos procesados viven en tablas, no en memoria.
* **Configuración por entorno:** el connection string se inyecta por `DATABASE_URL` (nunca se commitea).

### 🔜 Pendiente para E4 (Integración) — declarado, no implementado
E3 es autocontenido (persistencia + endpoints); la integración real es E4. Estos puntos ya están
**versionados en el contrato de eventos** y se implementan en E4:
* **Publisher real:** reemplazar el mock (consola) por **Supabase Realtime**, canal `inventory.events`.
* **Sobre completo del evento:** agregar `version` y `producer: "inventory-service"` (hoy el mock no los emite).
* **`StockRejected` v1.1:** incluir `userId` en el payload (lo requiere G9 para notificar). Se captura del
  `OrderCreated` de G5 (su payload ya lo trae) y se persiste en una columna `user_id` de `reservations`.
* **Consumidores de eventos:** `OrderCreated` (G5), `PaymentApproved`/`PaymentRejected` (G6, con capa de
  adaptación de su sobre no estándar) y `ProductCreated` (G3).
* **Protección de la carga de stock (contrato REST v1.1):** `POST /inventory/{id}/stock` pasará a exigir
  `Authorization: Bearer <jwt>` validando token y rol `admin` contra `GET /auth/validate` de **G2**
  (401/403 ya declarados en el contrato). Solo ese endpoint: reserva/confirmación/liberación son
  servicio-a-servicio (G5) y las lecturas son públicas. Requiere pedir a G2 un usuario admin de prueba.

---

## ⚙️ Arquitectura Técnica (Fase 3)

1. **Servidor y Routing:** `Node.js` + `Express` + `TypeScript`.
2. **Capa de Dominio:** Patrón de servicios (`reservations.ts`) con las reglas de negocio, validaciones "Todo-o-Nada" y control de estados (RESERVED -> CONFIRMED/RELEASED), ejecutadas dentro de una transacción.
3. **Control de Concurrencia:** **Transacción Postgres** (`withTransaction` en `config/database.ts`) con `UPDATE ... WHERE available_stock >= qty` y verificación de filas afectadas. Evita el "Double Spending" incluso con múltiples instancias del servicio.
4. **Persistencia (Repositorio):** **Supabase Postgres** vía `pg` (`repository/repository.ts`), schema `inventario`. Las 5 tablas se crean con `db/schema.sql`.
5. **Middlewares Core:** * `headers.middleware.ts`: validación y auto-generación de trazabilidad.
   * `error.middleware.ts`: estandarización de respuestas de error (códigos HTTP, `ApiError` custom).

---

## 🛠️ Cómo ejecutar localmente

> **Requisitos:** Node 20 LTS y npm.

1. **Clonar el repositorio y entrar a la carpeta:**
   ```bash
   git clone <tu-url-del-repo>
   cd InventarioG7
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Base de datos (proyecto Supabase propio de G7):**
   - Cada grupo tiene su **propia base de datos**: el servicio usa el proyecto Supabase de G7 (schema `inventario`). Pide al equipo el **connection string** del proyecto del grupo.
   - Las 5 tablas y el seed **ya están creados** en ese proyecto. Solo hay que (re)ejecutar `db/schema.sql` si se levanta una BD nueva desde cero (es idempotente: no pisa datos existentes).

4. **Crear el archivo `.env`** a partir del ejemplo y pegar el connection string del proyecto del grupo:
   ```bash
   cp .env.example .env
   ```
   - `DATABASE_URL`: el URI del **Session pooler** de Supabase (IPv4, host `...pooler.supabase.com:5432`, usuario `postgres.<project-ref>`). Reemplaza la contraseña; si tiene caracteres especiales, codifícalos en URL (espacio → `%20`).
     > **No uses la conexión "directa"** (`db.<ref>.supabase.co`): resuelve por IPv6 y falla en redes solo-IPv4 como Render (`ENETUNREACH`). El **pooler** da IPv4 y funciona en todos lados.
   - `DB_SCHEMA`: `inventario` (schema dedicado del servicio dentro del proyecto propio). Las queries califican el schema, así que funciona aunque el pooler ignore el `search_path`.
   - El servicio usa el puerto **3006** (estándar del curso).
   - ⚠️ El `.env` está en `.gitignore`: la contraseña de la BD **nunca se sube** al repo.

5. **Levantar en modo desarrollo** (recarga en caliente con `tsx`):
   ```bash
   npm run dev
   ```

6. **O compilar y correr en modo producción:**
   ```bash
   npm run build
   npm start
   ```

El servicio queda disponible en `http://localhost:3006` y la documentación interactiva (Swagger) en `http://localhost:3006/docs`.

---

## 🔌 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET`  | `/inventory` | Lista el inventario paginado (`?page=&size=`) |
| `GET`  | `/inventory/:productId` | Devuelve el inventario de un producto |
| `GET`  | `/inventory/:productId/stock` | Devuelve el stock de un producto |
| `POST` | `/inventory/:productId/stock` | Fija/incrementa stock (`SET` o `ADD`) — idempotente |
| `POST` | `/inventory/sync-catalog` | Sincroniza el catálogo de G3: crea el inventario de productos nuevos (idempotente) |
| `POST` | `/inventory/reserve` | Reserva stock para una orden (todo-o-nada) |
| `POST` | `/inventory/confirm` | Confirma una reserva (pago aprobado) |
| `POST` | `/inventory/release` | Libera una reserva (pago rechazado / cancelación) |

La definición completa está en `openapi/contrato-REST-inventario.yaml` y se sirve en `/docs`.

### Campos de stock (`InventoryView`)
- `availableStock`: stock disponible para vender.
- `reservedStock`: stock reservado esperando confirmación de pago.
- `totalStock`: físico en bodega = `availableStock + reservedStock`.
- `virtualStock`: stock vendible = `totalStock − reservedStock` (coincide con `availableStock`).

### Integración con el catálogo (G3) — Fase 4

`POST /inventory/sync-catalog` consume el API REST de G3 (`GET /products`, paginado) y
crea la fila de inventario de cada producto del catálogo que aún no exista, con
`availableStock` inicial = `stock_visible` del catálogo (mismo criterio del seed de E3,
que se hacía a mano). Los productos ya inventariados **no se tocan** y los inactivos se
omiten: re-ejecutar la sincronización es idempotente.

- El cliente (`src/clients/catalog.client.ts`) envía los headers obligatorios de G3
  (`X-Request-Id`, `X-Correlation-Id`, `X-Consumer`) propagando el `correlationId` del
  flujo, con timeout configurable (`CATALOG_TIMEOUT_MS`) por el cold start de Render free.
- Errores de integración mapeados: G3 caído → `502 CATALOG_UNAVAILABLE`, timeout →
  `504 CATALOG_TIMEOUT`, respuesta no exitosa → `502 CATALOG_ERROR`.
- Configuración: `CATALOG_BASE_URL` (ver `.env.example`).

```bash
curl -X POST https://inventario-g7.onrender.com/inventory/sync-catalog \
  -H "X-Consumer: inventory-admin" -H "X-Correlation-Id: demo-sync-1"
# → { "catalogProducts": 18, "created": 3, "alreadyTracked": 15, "skippedInactive": 0, ... }
```

### Eventos reales — RabbitMQ + patrón Outbox (Fase 4)

Desde E4 los eventos **se publican de verdad** al bus compartido del curso:
**RabbitMQ en CloudAMQP, exchange topic `payments.events`** (el mismo que usan G5 y
G6), con routing key = `eventType`. El mock de consola quedó atrás.

**Patrón Outbox** (`src/events/publisher.ts` + `src/events/dispatcher.ts` + tabla
`inventario.outbox_events`): el evento se inserta **en la misma transacción** que
cambia el stock — si la transacción hace ROLLBACK, el evento nunca existió (sin
eventos fantasma). Un dispatcher lo publica después (cada 5s, lotes con
`FOR UPDATE SKIP LOCKED`: seguro con varias instancias) y marca `published_at`.
Entrega *al menos una vez*: los consumidores deduplican por `eventId`.

| Evento | Cuándo | Consumidor esperado |
|---|---|---|
| `StockReserved` | Reserva creada | G10 |
| `StockConfirmed` | Reserva confirmada (pago OK) | G10 |
| `InventoryReleased` | Reserva liberada (antes `StockReleased`, renombrado para G5) | **G5** (ya suscrito), G10 |
| `StockRejected` **v1.1** | Reserva rechazada por falta de stock (se publica tras el ROLLBACK); incluye `userId` (nullable) para que G9 sepa a quién notificar | G9 |
| `StockChanged` | Carga/reposición de stock (admin) | G3 (refresca `stock_visible`) |

Sobre estándar del curso: `eventId`, `eventType`, `version`, `occurredAt`,
`producer: "inventory-service"`, `correlationId`, `payload`.
Configuración: `RABBITMQ_URL` (ver `.env.example`; en Render se define en el
dashboard). Sin la variable, el servicio funciona igual y los eventos quedan
encolados en el outbox hasta que haya broker.

### Consumo de eventos de pago (G6) — Fase 4

El servicio consume `payment.approved` y `payment.rejected` desde su **cola propia
durable `g7-inventory-service`** (acumula eventos aunque Render duerma el servicio)
en el mismo exchange, y reacciona solo:

| Evento de G6 | Acción automática | Evento que emite a su vez |
|---|---|---|
| `payment.approved` | Confirma la reserva del pedido (stock sale definitivo) | `StockConfirmed` |
| `payment.rejected` | Libera la reserva (stock vuelve a disponible) | `InventoryReleased` (lo recibe G5) |

Esto cierra el hueco del flujo: G5 marca el pedido `PAID` al aprobarse el pago pero
no confirma el stock — ahora el inventario se entera por el bus y lo hace solo
(consistencia eventual coreografiada).

- **Capa de adaptación** (`adaptPaymentEvent` en `src/events/consumer.ts`): el sobre
  de G6 no es estándar (`eventName`/`timestamp`, sin `correlationId`); se normaliza
  y soporta también el sobre estándar por si G6 migra.
- **Idempotencia de consumo (caso obligatorio)**: los `eventId` procesados se
  registran en `inventario.processed_events`; un evento re-entregado no
  confirma/libera dos veces. Además `confirm`/`release` son idempotentes por sí
  mismos (`FOR UPDATE` + transición condicional).
- Pagos de pedidos sin reserva en inventario → se registran y descartan (`no aplica`).
- Configuración: `RABBITMQ_QUEUE` (default `g7-inventory-service`).

### Consumo de `OrderCreated` (G5) e identidad del comprador — v1.6

La misma cola consume el **`OrderCreated` de G5** para enlazar la reserva con los
datos que a G7 no le llegan por REST:

- **`order_uuid`**: G5 nos llama por `orderNumber` (`ORD-...`) pero en el bus su
  orden viaja como UUID. Con ambos guardados, `confirm`/`release` y los eventos de
  pago **resuelven la reserva venga el identificador que venga**.
- **`user_id`**: el `business_user_id` del comprador (formato `USR-01` de G2),
  necesario para el `StockRejected` v1.1.

Además `POST /inventory/reserve` acepta **`userId` opcional** en el body (v1.6):
es la única forma de tener el `userId` en los rechazos, porque cuando la reserva
falla G5 **no** publica `OrderCreated` (el rechazo ocurre antes). Pedido a G5:
incluir el campo — ya tienen el valor validado al momento de llamar.

### Integración con identidad (G2) — Fase 4

Desde E4, `POST /inventory/:productId/stock` (la única vía de entrada de stock al
sistema) **exige `Authorization: Bearer <jwt>` con rol `admin`**. El middleware
(`src/middlewares/auth.middleware.ts`) valida el token contra `GET /auth/validate`
de G2 en cada petición:

| Caso | Respuesta |
|---|---|
| Sin token / token inválido o expirado | `401 UNAUTHORIZED` |
| Token válido pero rol ≠ `admin` | `403 FORBIDDEN` |
| G2 caído / timeout | `502 AUTH_UNAVAILABLE` / `504 AUTH_TIMEOUT` (fail closed) |

Para obtener un token admin en demos se usa el usuario sembrado por G2
(documentado en su README): `maria@correo.cl` / `AdminClave123`.

```bash
TOKEN=$(curl -s -X POST https://auth-minimarket-cloud.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@correo.cl","password":"AdminClave123"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

curl -X POST https://inventario-g7.onrender.com/inventory/<productId>/stock \
  -H "Authorization: Bearer $TOKEN" -H "X-Consumer: inventory-admin" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{"quantity": 10, "operation": "SET"}'
```

Reserva/confirmación/liberación **no** llevan JWT (son llamadas
servicio-a-servicio de G5) y las lecturas siguen siendo públicas.
Configuración: `AUTH_BASE_URL` (ver `.env.example`).

---

## 📨 Headers obligatorios

| Header | Obligatorio | Uso |
|---|---|---|
| `X-Consumer` | **Sí** (todas las rutas) | Identifica al grupo que llama. Si falta → `400` |
| `X-Request-Id` | No (se autogenera) | Trazabilidad por request |
| `X-Correlation-Id` | No (se autogenera) | Correlación de un flujo entre servicios |
| `Idempotency-Key` | **Sí** en `reserve` y `POST .../stock` | Evita reservas/cambios duplicados ante reintentos |

### Formato de error estándar
```json
{
  "timestamp": "2026-06-25T12:00:00.000Z",
  "status": 422,
  "code": "OUT_OF_STOCK",
  "message": "Insufficient stock for product ...",
  "correlationId": "..."
}
```

---

## 🧪 Pruebas (Postman)

La colección está en `postman/inventory.postman_collection.json`. Incluye 7 requests que cubren los flujos principales de forma **secuencial**: listar inventario, error por header faltante, consultar stock, reabastecer, reservar la última unidad (`201`), rechazo por falta de stock (`422`) y confirmar la reserva.

> La colección **no** prueba concurrencia real (sus requests corren en secuencia). El caso de dos pedidos compitiendo **simultáneamente** por la última unidad se valida con el script `scripts/concurrency-test.mjs` (ver abajo).

Importar en Postman → ajustar la variable de entorno con la URL (local `http://localhost:3006` o la URL pública del servicio).

### Datos semilla (en `db/schema.sql`)
| productId | availableStock |
|---|---|
| `550e8400-e29b-41d4-a716-446655440000` | 15 |
| `660e8400-e29b-41d4-a716-446655440111` | 1 (para la demo del último stock) |

> El seed se inserta con `ON CONFLICT DO NOTHING`: re-correr el script no pisa el stock existente. Para reiniciar a un estado limpio (p. ej. antes de una demo), usa `POST /inventory/:productId/stock` con `{ "quantity": N, "operation": "SET" }`.

### Prueba de concurrencia (Race Condition)

El script `scripts/concurrency-test.mjs` verifica el control de concurrencia disparando **N reservas en paralelo** por la última unidad del mismo producto. Como solo hay 1 unidad, el resultado esperado es **exactamente 1 reserva con éxito (`201`) y el resto rechazadas (`422 OUT_OF_STOCK`)** — sin sobreventa. Demuestra que la **transacción de Postgres** (`UPDATE ... WHERE available_stock >= qty`) serializa correctamente los accesos concurrentes a nivel de fila.

```bash
# Contra el servicio en Render (10 peticiones por defecto)
node scripts/concurrency-test.mjs

# Contra el servicio local, indicando número de peticiones
node scripts/concurrency-test.mjs http://localhost:3006 20
```

El script resetea el producto a 1 unidad (operación `SET`), lanza las reservas con `Promise.all` y afirma el resultado (sale con código 0 si pasa, 1 si falla).

### Pruebas de concurrencia del ciclo de vida (E4)

`scripts/concurrency-lifecycle-test.mjs` cubre las carreras del resto del ciclo de la
reserva, cada una con su guarda a nivel de base de datos:

| Carrera | Resultado esperado | Guarda |
|---|---|---|
| Doble reserva del mismo `orderId` (claves distintas, en paralelo) | 1×`201`, resto `409`; stock descontado una vez | Índice único parcial `uq_reservations_active_order` |
| `confirm` y `release` simultáneos del mismo pedido | 1×`200`, el otro `409`; un solo efecto en el stock | `SELECT ... FOR UPDATE` + transición de estado condicional |
| Replay concurrente de la misma `Idempotency-Key` | 1×`201`, resto `200`/`409`; **nunca** `500` | UNIQUE de `idempotency_key` + mapeo `23505 → 409 DUPLICATED_REQUEST` |
| Reservas multi-item con productos en común | Sin deadlocks | Items procesados siempre ordenados por `productId` |

```bash
node scripts/concurrency-lifecycle-test.mjs                    # contra Render
node scripts/concurrency-lifecycle-test.mjs http://localhost:3006
```

---

## 🌐 Despliegue

Desplegado en **Render** (plan Free) con persistencia en **Supabase Postgres**.

- **URL pública:** https://inventario-g7.onrender.com
- **Documentación (Swagger):** https://inventario-g7.onrender.com/docs
- **Health check:** https://inventario-g7.onrender.com/health
- **Build:** `npm install && npm run build` · **Start:** `npm start`.
- Render inyecta su propia variable `PORT`; el servicio la respeta automáticamente.
- **Variable de entorno requerida en Render:** `DATABASE_URL` = el **Session pooler** del proyecto Supabase de G7 (IPv4). Se configura en el dashboard de Render (Environment), **no** en el repo. `DB_SCHEMA=inventario` ya viene declarada en `render.yaml`.
  > ⚠️ Render free sale **solo por IPv4**; la conexión directa de Supabase es IPv6 → usar **sí o sí el pooler** o el deploy falla con `ENETUNREACH`.
- ⚠️ En el plan Free el servicio se duerme tras inactividad: el primer request tras un rato puede tardar ~30–60s (cold start). El estado **ya no se pierde** en el cold start: vive en Postgres.

---

## 🚧 Pendiente para Fase 4 (Integración)
- Conectar el bus de eventos real (**Supabase Realtime**, canal `inventory.events`) y consumir `OrderCreated` (G5) y eventos de pago (G6). Hoy el publisher solo registra los eventos por consola.
- Job batch que expire las reservas `RESERVED` vencidas (TTL) → `EXPIRED`.
- Integración REST end-to-end con los consumidores (G5, G10, G11).