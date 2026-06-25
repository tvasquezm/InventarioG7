"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.headersMiddleware = headersMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const error_middleware_1 = require("./error.middleware");
function headersMiddleware(req, res, next) {
    const requestId = req.header("X-Request-Id") ??
        crypto_1.default.randomUUID();
    const correlationId = req.header("X-Correlation-Id") ??
        crypto_1.default.randomUUID();
    const consumer = req.header("X-Consumer");
    if (!consumer) {
        // CORREGIDO: Usar código estandarizado INVALID_REQUEST para el ecosistema
        next(new error_middleware_1.ApiError(400, "INVALID_REQUEST", "Header X-Consumer is required."));
        return;
    }
    // Guardar en headers internos (en minúsculas para consistencia con Express)
    req.headers["x-request-id"] = requestId;
    req.headers["x-correlation-id"] = correlationId;
    req.headers["x-consumer"] = consumer;
    // Responder reflejando los headers procesados
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Correlation-Id", correlationId);
    res.setHeader("X-Consumer", consumer);
    next();
}
//# sourceMappingURL=headers.middleware.js.map