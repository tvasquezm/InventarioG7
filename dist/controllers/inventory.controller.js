"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryController = exports.InventoryController = void 0;
const reservations_1 = require("../domain/reservations");
const repository_1 = require("../repository/repository");
const error_middleware_1 = require("../middlewares/error.middleware");
const publisher_1 = require("../events/publisher"); // <-- AÑADIDO: Para emitir StockChanged
class InventoryController {
    /**
     * GET /inventory
     */
    getInventory(req, res, next) {
        try {
            const page = Number(req.query.page ?? 1);
            const size = Number(req.query.size ?? 20);
            if (page < 1 ||
                size < 1 ||
                size > 100) {
                throw new error_middleware_1.ApiError(400, "INVALID_REQUEST", "Invalid pagination parameters.");
            }
            const inventory = repository_1.repository.listInventory();
            const start = (page - 1) * size;
            const data = inventory
                .slice(start, start + size)
                .map(item => repository_1.repository.toInventoryView(item));
            res.status(200).json({
                data,
                pagination: {
                    page,
                    size,
                    total: inventory.length,
                    totalPages: Math.ceil(inventory.length / size)
                }
            });
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * GET /inventory/:productId
     */
    getInventoryByProductId(req, res, next) {
        try {
            const rawProductId = req.params.productId;
            if (!rawProductId ||
                Array.isArray(rawProductId)) {
                throw new error_middleware_1.ApiError(400, "INVALID_PRODUCT_ID", "Product ID is required.");
            }
            const inventory = repository_1.repository.getInventory(rawProductId);
            if (!inventory) {
                throw new error_middleware_1.ApiError(404, "PRODUCT_NOT_FOUND", "Product not found.");
            }
            res.status(200).json(repository_1.repository.toInventoryView(inventory));
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * GET /inventory/:productId/stock
     */
    getStock(req, res, next) {
        this.getInventoryByProductId(req, res, next);
    }
    /**
     * POST /inventory/:productId/stock
     */
    setStock(req, res, next) {
        try {
            const idempotencyKey = req.header("Idempotency-Key");
            // <-- AÑADIDO: Extraer trazabilidad
            const correlationId = req.headers["x-correlation-id"];
            if (!idempotencyKey ||
                idempotencyKey.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required.");
            }
            const rawProductId = req.params.productId;
            if (!rawProductId ||
                Array.isArray(rawProductId)) {
                throw new error_middleware_1.ApiError(400, "INVALID_PRODUCT_ID", "Product ID is required.");
            }
            const { quantity, operation } = req.body;
            if (typeof quantity !== "number" ||
                quantity < 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_REQUEST", "Quantity must be a number greater than or equal to 0.");
            }
            if (operation !== "SET" &&
                operation !== "ADD") {
                throw new error_middleware_1.ApiError(400, "INVALID_REQUEST", "Operation must be SET or ADD.");
            }
            // ========================================
            // IDEMPOTENCIA REAL
            // Si esta key ya fue usada, devolvemos
            // la misma respuesta sin volver a tocar stock.
            // ========================================
            const existingRecord = repository_1.repository.findStockIdempotencyKey(idempotencyKey);
            if (existingRecord) {
                const sameRequest = existingRecord.productId === rawProductId &&
                    existingRecord.quantity === quantity &&
                    existingRecord.operation === operation;
                if (!sameRequest) {
                    throw new error_middleware_1.ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different stock operation.");
                }
                res.status(200).json(existingRecord.response);
                return;
            }
            const inventory = repository_1.repository.getInventory(rawProductId);
            if (!inventory) {
                throw new error_middleware_1.ApiError(404, "PRODUCT_NOT_FOUND", "Product not found.");
            }
            const updatedInventory = repository_1.repository.updateStock(rawProductId, quantity, operation);
            const response = repository_1.repository.toInventoryView(updatedInventory);
            repository_1.repository.saveStockIdempotencyKey(idempotencyKey, {
                productId: rawProductId,
                operation,
                quantity,
                response
            });
            // <-- AÑADIDO: Publicar el evento obligatorio del ecosistema (Fase 2)
            publisher_1.publisher.publishStockChanged(rawProductId, response, correlationId);
            res.status(200).json(response);
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * POST /inventory/reserve
     */
    async reserve(req, res, next) {
        try {
            const idempotencyKey = req.header("Idempotency-Key");
            // <-- AÑADIDO: Extraer trazabilidad
            const correlationId = req.headers["x-correlation-id"];
            if (!idempotencyKey ||
                idempotencyKey.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required.");
            }
            const { orderId, items } = req.body;
            const result = await reservations_1.reservationService.reserveStock({
                orderId,
                idempotencyKey,
                items,
                correlationId // <-- AÑADIDO: Pasar al dominio
            });
            const statusCode = result.isIdempotentReplay ? 200 : 201;
            res
                .status(statusCode)
                .json(result.reservation);
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * POST /inventory/confirm
     */
    async confirmReservation(req, res, next) {
        try {
            const { orderId } = req.body;
            // <-- AÑADIDO: Extraer trazabilidad
            const correlationId = req.headers["x-correlation-id"];
            if (!orderId ||
                typeof orderId !== "string" ||
                orderId.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
            }
            const reservation = await reservations_1.reservationService.confirmReservation(orderId, correlationId // <-- AÑADIDO: Pasar al dominio
            );
            res.status(200).json(reservation);
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * POST /inventory/release
     */
    async releaseReservation(req, res, next) {
        try {
            const { orderId } = req.body;
            // <-- AÑADIDO: Extraer trazabilidad
            const correlationId = req.headers["x-correlation-id"];
            if (!orderId ||
                typeof orderId !== "string" ||
                orderId.trim().length === 0) {
                throw new error_middleware_1.ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
            }
            const reservation = await reservations_1.reservationService.releaseReservation(orderId, correlationId // <-- AÑADIDO: Pasar al dominio
            );
            res.status(200).json(reservation);
        }
        catch (error) {
            next(error);
        }
    }
}
exports.InventoryController = InventoryController;
exports.inventoryController = new InventoryController();
//# sourceMappingURL=inventory.controller.js.map