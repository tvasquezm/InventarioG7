import express from "express";
import cors from "cors";
import path from "path";

import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import fs from "fs";

import inventoryRoutes from "./routes/inventory.routes";

import { loadSeedData } from "./config/seed";
import { headersMiddleware } from "./middlewares/headers.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

const PORT = process.env.PORT || 3000;

/**
 * Middlewares
 */
app.use(cors());
app.use(express.json());
app.use(headersMiddleware);

/**
 * Datos semilla
 */
loadSeedData();

/**
 * Rutas
 */
app.use("/", inventoryRoutes);

/**
 * Swagger (/docs)
 */
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
 * Middleware global de errores
 */
app.use(errorMiddleware);

/**
 * Servidor
 */
app.listen(PORT, () => {

  console.log("======================================");
  console.log(" Inventory Service (Grupo 7)");
  console.log("======================================");
  console.log(` Server running on port ${PORT}`);
  console.log(` Swagger: http://localhost:${PORT}/docs`);
  console.log("======================================");

});