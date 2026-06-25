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
const PORT = process.env.PORT || 3000;
/**
 * Middlewares
 */
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(headers_middleware_1.headersMiddleware);
/**
 * Datos semilla
 */
(0, seed_1.loadSeedData)();
/**
 * Rutas
 */
app.use("/", inventory_routes_1.default);
/**
 * Swagger (/docs)
 */
const openApiPath = path_1.default.join(__dirname, "../openapi/contrato-REST-inventario.yaml");
const openApiFile = fs_1.default.readFileSync(openApiPath, "utf8");
const swaggerDocument = yaml_1.default.parse(openApiFile);
app.use("/docs", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerDocument));
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