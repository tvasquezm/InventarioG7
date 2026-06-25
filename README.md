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

### 🚀 Fase 2: Implementación Mock y Lógica Core (Estado Actual)
En esta fase, hemos implementado el contrato definido en la Fase 1 desarrollando un servidor funcional (Mock). Aunque la persistencia de datos es en memoria por ahora, la **lógica de negocio y las validaciones son definitivas y listas para producción**.
* **Protección contra Race Conditions:** Implementación de bloqueos (Mutex) para simular transacciones seguras de base de datos y manejar dobles reservas.
* **Idempotencia Transaccional:** Uso estricto del header `Idempotency-Key` para evitar cargos o reservas dobles ante reintentos de red.
* **Trazabilidad (Correlation):** Propagación y registro de `X-Correlation-Id` en todos los flujos y eventos emitidos.
* **Mock Event Publisher:** Simulación de un bus de eventos (event-driven) publicando en consola los eventos del dominio según el contrato de Fase 1 (`StockReserved`, `StockRejected`, `StockConfirmed`, `StockReleased`, `StockChanged`).

---

## ⚙️ Arquitectura Técnica (Fase 2)

Dado que esta es una fase "Mock" orientada a validar la lógica de concurrencia y los contratos, la arquitectura se compone de:

1. **Servidor y Routing:** `Node.js` + `Express` + `TypeScript`.
2. **Capa de Dominio:** Patrón de servicios (`reservations.ts`) centralizando las reglas de negocio, validaciones "Todo-o-Nada" para reservas y control de estados (RESERVED -> CONFIRMED/RELEASED).
3. **Control de Concurrencia:** Uso de la librería `async-mutex` para serializar las peticiones concurrentes y evitar el "Double Spending" de inventario (Race Conditions).
4. **Persistencia (Repositorio):** Almacenamiento _In-Memory_ utilizando Maps y Sets de TypeScript para simular tablas, claves primarias y registros de idempotencia.
5. **Middlewares Core:** * `headers.middleware.ts`: Validación y auto-generación de trazabilidad.
   * `error.middleware.ts`: Estandarización de respuestas de error al formato acordado (códigos HTTP, `ApiError` custom).

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

3. **(Opcional) Crear el archivo `.env`** a partir del ejemplo:
   ```bash
   cp .env.example .env
   ```
   El servicio usa el puerto **3006** (estándar del curso). Si no se define `PORT`, usa 3006 por defecto.

4. **Levantar en modo desarrollo** (recarga en caliente con `tsx`):
   ```bash
   npm run dev
   ```

5. **O compilar y correr en modo producción:**
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

### Datos semilla (al arrancar)
| productId | availableStock |
|---|---|
| `550e8400-e29b-41d4-a716-446655440000` | 15 |
| `660e8400-e29b-41d4-a716-446655440111` | 1 (para la demo del último stock) |

### Prueba de concurrencia (Race Condition)

El script `scripts/concurrency-test.mjs` verifica el control de concurrencia disparando **N reservas en paralelo** por la última unidad del mismo producto. Como solo hay 1 unidad, el resultado esperado es **exactamente 1 reserva con éxito (`201`) y el resto rechazadas (`422 OUT_OF_STOCK`)** — sin sobreventa. Demuestra que el `async-mutex` serializa correctamente los accesos concurrentes.

```bash
# Contra el mock en Render (10 peticiones por defecto)
node scripts/concurrency-test.mjs

# Contra el mock local, indicando número de peticiones
node scripts/concurrency-test.mjs http://localhost:3006 20
```

El script resetea el producto a 1 unidad (operación `SET`), lanza las reservas con `Promise.all` y afirma el resultado (sale con código 0 si pasa, 1 si falla).

---

## 🌐 Despliegue (mock público)

Desplegado en **Render** (plan Free).

- **URL pública:** https://inventario-g7.onrender.com
- **Documentación (Swagger):** https://inventario-g7.onrender.com/docs
- **Health check:** https://inventario-g7.onrender.com/health
- **Build:** `npm install && npm run build` · **Start:** `npm start` (o usando el `Dockerfile`).
- Render inyecta su propia variable `PORT`; el servicio la respeta automáticamente.
- ⚠️ En el plan Free el servicio se duerme tras inactividad: el primer request tras un rato puede tardar ~30–60s (cold start).
- ⚠️ El store es **en memoria y compartido**: todos los consumidores pegan a la misma instancia y el estado se reinicia con cada cold start/redeploy.

---

## 🚧 Pendiente para Fase 3
- Reemplazar el store en memoria por **Supabase Postgres**.
- Conectar el bus de eventos real (**Supabase Realtime**, canal `inventory.events`) y consumir `OrderCreated` (G5) y eventos de pago (G6). En Fase 2 el publisher solo simula los eventos por consola.