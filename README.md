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
* **Mock Event Publisher:** Simulación de un bus de eventos (event-driven) publicando en consola los eventos del dominio (`inventory.reserved`, `inventory.stock_rejected`, etc.).

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

1. **Clonar el repositorio y entrar a la carpeta:**
   ```bash
   git clone <tu-url-del-repo>
   cd <nombre-carpeta>