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
* **Persistencia SQL:** las 5 tablas del modelo de datos en Postgres (`db/schema.sql`), schema dedicado `inventario` (en el Supabase compartido del curso).
* **Concurrencia real:** reserva todo-o-nada dentro de `BEGIN/COMMIT`; el `UPDATE` condicional descuenta solo si hay stock (si afecta 0 filas → `422 OUT_OF_STOCK`).
* **Idempotencia persistente:** las claves de idempotencia (reservas y operaciones de stock) y los eventos procesados viven en tablas, no en memoria.
* **Configuración por entorno:** el connection string se inyecta por `DATABASE_URL` (nunca se commitea).

---

## ⚙️ Arquitectura Técnica (Fase 3)

1. **Servidor y Routing:** `Node.js` + `Express` + `TypeScript`.
2. **Capa de Dominio:** Patrón de servicios (`reservations.ts`) con las reglas de negocio, validaciones "Todo-o-Nada" y control de estados (RESERVED -> CONFIRMED/RELEASED), ejecutadas dentro de una transacción.
3. **Control de Concurrencia:** **Transacción Postgres** (`withTransaction` en `config/database.ts`) con `UPDATE ... WHERE available_stock >= qty` y verificación de filas afectadas. Evita el "Double Spending" incluso con múltiples instancias del servicio.
4. **Persistencia (Repositorio):** **Supabase Postgres** vía `pg` (`repository/repository.ts`). Las 5 tablas se crean con `db/schema.sql`.
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

3. **Crear la base de datos (Supabase):**
   - Crea un proyecto en [supabase.com](https://supabase.com).
   - En **SQL Editor → New snippet**, pega y ejecuta todo `db/schema.sql` (crea las 5 tablas + datos semilla; es idempotente).
   - Copia el connection string en **Project Settings → Database → Connection string (URI)**.

4. **Crear el archivo `.env`** a partir del ejemplo y poner el connection string:
   ```bash
   cp .env.example .env
   ```
   - `DATABASE_URL`: el URI de Supabase (reemplaza la contraseña; si tiene espacios u otros caracteres, codifícalos en URL, p. ej. espacio → `%20`).
   - `DB_SCHEMA`: `inventario` (schema de G7 en el Supabase compartido).
   - El servicio usa el puerto **3006** (estándar del curso).
   - ⚠️ El `.env` está en `.gitignore`: **nunca se sube la contraseña**.

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

## 🐳 Ejecutar con Docker

```bash
docker build -t inventario-g7 .
docker run -p 3006:3006 inventario-g7
```

---

## 🔌 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET`  | `/inventory` | Lista el inventario paginado (`?page=&size=`) |
| `GET`  | `/inventory/:productId` | Devuelve el inventario de un producto |
| `GET`  | `/inventory/:productId/stock` | Devuelve el stock de un producto |
| `POST` | `/inventory/:productId/stock` | Fija/incrementa stock (`SET` o `ADD`) — idempotente |
| `POST` | `/inventory/reserve` | Reserva stock para una orden (todo-o-nada) |
| `POST` | `/inventory/confirm` | Confirma una reserva (pago aprobado) |
| `POST` | `/inventory/release` | Libera una reserva (pago rechazado / cancelación) |

La definición completa está en `openapi/contrato-REST-inventario.yaml` y se sirve en `/docs`.

### Campos de stock (`InventoryView`)
- `availableStock`: stock disponible para vender.
- `reservedStock`: stock reservado esperando confirmación de pago.
- `totalStock`: físico en bodega = `availableStock + reservedStock`.
- `virtualStock`: stock vendible = `totalStock − reservedStock` (coincide con `availableStock`).

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

La colección está en `postman/inventory.postman_collection.json`. Incluye los 7 endpoints y el **caso crítico de concurrencia**: dos pedidos compiten por la última unidad → uno reserva con éxito (`201`) y el otro es rechazado (`422`), dejando el stock final en 0.

Importar en Postman → ajustar la variable de entorno con la URL (local `http://localhost:3006` o la URL pública del mock).

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

---

## 🌐 Despliegue

Desplegado en **Render** (plan Free) con persistencia en **Supabase Postgres**.

- **URL pública:** https://inventario-g7.onrender.com
- **Documentación (Swagger):** https://inventario-g7.onrender.com/docs
- **Health check:** https://inventario-g7.onrender.com/health
- **Build:** `npm install && npm run build` · **Start:** `npm start` (o usando el `Dockerfile`).
- Render inyecta su propia variable `PORT`; el servicio la respeta automáticamente.
- **Variable de entorno requerida en Render:** `DATABASE_URL` (el connection string de Supabase). Se configura en el dashboard de Render (Environment), **no** en el repo.
- ⚠️ En el plan Free el servicio se duerme tras inactividad: el primer request tras un rato puede tardar ~30–60s (cold start). El estado **ya no se pierde** en el cold start: vive en Postgres.

---

## 🚧 Pendiente para Fase 4 (Integración)
- Conectar el bus de eventos real (**Supabase Realtime**, canal `inventory.events`) y consumir `OrderCreated` (G5) y eventos de pago (G6). Hoy el publisher solo registra los eventos por consola.
- Job batch que expire las reservas `RESERVED` vencidas (TTL) → `EXPIRED`.
- Integración REST end-to-end con los consumidores (G5, G10, G11).