import "dotenv/config";

import express from "express";
import cors from "cors";
import path from "path";

import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import fs from "fs";

import inventoryRoutes from "./routes/inventory.routes";

import { catalogClient } from "./clients/catalog.client";
import { pingDatabase } from "./config/database";
import { startOutboxDispatcher } from "./events/dispatcher";
import { startPaymentsConsumer } from "./events/consumer";
import { startExpiryJob } from "./jobs/expiry.job";
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
 * Interfaz de administracion del inventario (Fase 4).
 * Pagina estatica autocontenida: lista el stock, permite reponer
 * (login admin real contra G2) y sincronizar el catalogo de G3.
 */
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

/**
 * Nombres de producto para la UI, via nuestro cliente de G3 (el
 * catalogo no expone CORS, asi que el navegador no puede llamarlo
 * directo). Cache en memoria de 5 minutos para no golpear a G3.
 */
let namesCache: { at: number; data: Record<string, string> } | null = null;

app.get("/admin/catalog-names", async (_req, res) => {
  const TTL_MS = 5 * 60 * 1000;
  if (namesCache && Date.now() - namesCache.at < TTL_MS) {
    res.json(namesCache.data);
    return;
  }
  try {
    const products = await catalogClient.getAllProducts(`admin-ui-${Date.now()}`);
    const data: Record<string, string> = {};
    for (const p of products) data[p.id] = p.name;
    namesCache = { at: Date.now(), data };
    res.json(data);
  } catch {
    // Sin catalogo no se cae la UI: muestra UUIDs.
    res.json(namesCache?.data ?? {});
  }
});

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

  // Batch: expira reservas RESERVED con TTL vencido y devuelve su stock.
  startExpiryJob();

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