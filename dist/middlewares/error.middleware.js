"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.errorMiddleware = errorMiddleware;
/**
 * Error personalizado del servicio.
 */
class ApiError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiError";
    }
}
exports.ApiError = ApiError;
/**
 * Middleware global de manejo de errores.
 */
function errorMiddleware(err, req, res, next) {
    if (err instanceof ApiError) {
        res.status(err.status).json({
            timestamp: new Date().toISOString(),
            status: err.status,
            code: err.code,
            message: err.message,
            correlationId: req.headers["x-correlation-id"] ?? null
        });
        return;
    }
    console.error(err);
    res.status(500).json({
        timestamp: new Date().toISOString(),
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
        correlationId: req.headers["x-correlation-id"] ?? null
    });
}
//# sourceMappingURL=error.middleware.js.map