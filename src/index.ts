import "dotenv/config";

import express from "express";
import cors from "cors";
import path from "path";

import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import fs from "fs";

import inventoryRoutes from "./routes/inventory.routes";

import { pingDatabase } from "./config/database";
import { startOutboxDispatcher } from "./events/dispatcher";
import { startPaymentsConsumer } from "./events/consumer";
import { headersMiddleware } from "./middlewares/headers.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

// Puerto mandatorio del estandar del curso es 3006.
const PORT = process.env.PORT || 3006;

/**
 * Middlewares base
 */
app.use(cors());
app.use(express.json());

/**
 * Rutas publicas (sin X-Consumer): health check y documentacion.
 * Se montan ANTES del headersMiddleware para que el navegador
 * pueda abrir /docs y Render pueda chequear /health sin headers.
 */
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "inventory-service" });
});

const openApiPath = path.join(
  __dirname,
  "../openapi/contrato-REST-inventario.yaml"
);

const openApiFile = fs.readFileSync(openApiPath, "utf8");
const swaggerDocument = YAML.parse(openApiFile);

app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument)
);

/**
 * A partir de aqui, todas las rutas exigen X-Consumer
 */
app.use(headersMiddleware);

/**
 * Rutas de negocio
 */
app.use("/", inventoryRoutes);

/**
 * Middleware global de errores
 */
app.use(errorMiddleware);

/**
 * Servidor: primero verifica la conexion a Postgres (Supabase),
 * luego levanta el HTTP.
 */
async function start() {
  await pingDatabase();
  console.log("✓ Conexion a Postgres (Supabase) OK");

  // Publica los eventos del outbox a RabbitMQ (Fase 4).
  startOutboxDispatcher();

  // Consume payment.approved/rejected de G6: confirma/libera reservas solo.
  startPaymentsConsumer();

  app.listen(PORT, () => {
    console.log("======================================");
    console.log(" Inventory Service (Grupo 7)");
    console.log("======================================");
    console.log(` Server running on port ${PORT}`);
    console.log(` Swagger docs: http://localhost:${PORT}/docs`);
    console.log("======================================");
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el servicio:", err);
  process.exit(1);
});