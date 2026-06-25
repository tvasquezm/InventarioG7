"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const yaml_1 = __importDefault(require("yaml"));
const fs_1 = __importDefault(require("fs"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const seed_1 = require("./config/seed");
const headers_middleware_1 = require("./middlewares/headers.middleware");
const error_middleware_1 = require("./middlewares/error.middleware");
const app = (0, express_1.default)();
// Puerto mandatorio del estandar del curso es 3006.
const PORT = process.env.PORT || 3006;
/**
 * Middlewares base
 */
app.use((0, cors_1.default)());
app.use(express_1.default.json());
/**
 * Rutas publicas (sin X-Consumer): health check y documentacion.
 * Se montan ANTES del headersMiddleware para que el navegador
 * pueda abrir /docs y Render pueda chequear /health sin headers.
 */
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "inventory-service" });
});
const openApiPath = path_1.default.join(__dirname, "../openapi/contrato-REST-inventario.yaml");
const openApiFile = fs_1.default.readFileSync(openApiPath, "utf8");
const swaggerDocument = yaml_1.default.parse(openApiFile);
app.use("/docs", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerDocument));
/**
 * A partir de aqui, todas las rutas exigen X-Consumer
 */
app.use(headers_middleware_1.headersMiddleware);
/**
 * Datos semilla
 */
(0, seed_1.loadSeedData)();
/**
 * Rutas de negocio
 */
app.use("/", inventory_routes_1.default);
/**
 * Middleware global de errores
 */
app.use(error_middleware_1.errorMiddleware);
/**
 * Servidor
 */
app.listen(PORT, () => {
    console.log("======================================");
    console.log(" Inventory Service (Grupo 7) - MOCK");
    console.log("======================================");
    console.log(` Server running on port ${PORT}`);
    console.log(` Swagger docs: http://localhost:${PORT}/docs`);
    console.log("======================================");
});
//# sourceMappingURL=index.js.map