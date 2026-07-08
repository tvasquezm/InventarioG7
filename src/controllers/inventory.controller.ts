import { Request, Response, NextFunction } from "express";
import { reservationService } from "../domain/reservations";
import { catalogSyncService } from "../domain/catalog-sync";
import { repository } from "../repository/repository";
import { withTransaction } from "../config/database";
import { ApiError } from "../middlewares/error.middleware";
import { publisher } from "../events/publisher";

export class InventoryController {

  /**
   * GET /inventory
   */
  async getInventory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const page = Number(req.query.page ?? 1);
      const size = Number(req.query.size ?? 20);

      if (page < 1 || size < 1 || size > 100) {
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Invalid pagination parameters."
        );
      }

      const total = await repository.countInventory();
      const offset = (page - 1) * size;

      const rows = await repository.listInventoryPage(size, offset);
      const data = rows.map(item => repository.toInventoryView(item));

      res.status(200).json({
        data,
        pagination: {
          page,
          size,
          total,
          totalPages: Math.ceil(total / size)
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
  async getInventoryByProductId(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const rawProductId = req.params.productId;

      if (!rawProductId || Array.isArray(rawProductId)) {
        throw new ApiError(
          400,
          "INVALID_PRODUCT_ID",
          "Product ID is required."
        );
      }

      const inventory = await repository.getInventory(rawProductId);

      if (!inventory) {
        throw new ApiError(
          404,
          "PRODUCT_NOT_FOUND",
          "Product not found."
        );
      }

      res.status(200).json(repository.toInventoryView(inventory));

    }
    catch (error) {
      next(error);
    }

  }

  /**
   * GET /inventory/:productId/stock
   */
  async getStock(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    await this.getInventoryByProductId(req, res, next);

  }

  /**
   * POST /inventory/:productId/stock
   */
  async setStock(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const idempotencyKey = req.header("Idempotency-Key");
      const correlationId = req.headers["x-correlation-id"] as string;

      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new ApiError(
          400,
          "MISSING_IDEMPOTENCY_KEY",
          "Idempotency-Key header is required."
        );
      }

      const rawProductId = req.params.productId;

      if (!rawProductId || Array.isArray(rawProductId)) {
        throw new ApiError(
          400,
          "INVALID_PRODUCT_ID",
          "Product ID is required."
        );
      }

      const { quantity, operation } = req.body;

      if (typeof quantity !== "number" || quantity < 0) {
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Quantity must be a number greater than or equal to 0."
        );
      }

      if (operation !== "SET" && operation !== "ADD") {
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Operation must be SET or ADD."
        );
      }

      // ========================================
      // IDEMPOTENCIA REAL (en transaccion)
      // Reclamamos la clave con un INSERT; si ya existia,
      // es un replay y no volvemos a tocar el stock.
      // ========================================

      const result = await withTransaction(async (client) => {

        const inventory = await repository.getInventory(rawProductId, client);

        if (!inventory) {
          throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product not found.");
        }

        const claimed = await repository.saveStockOperation(
          idempotencyKey,
          { productId: rawProductId, operation, quantity },
          client
        );

        if (!claimed) {
          // Replay: validar que sea la misma operacion y devolver estado actual.
          const existing = await repository.findStockOperation(idempotencyKey, client);

          if (
            existing &&
            !(existing.productId === rawProductId &&
              existing.quantity === quantity &&
              existing.operation === operation)
          ) {
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "Idempotency-Key was already used with a different stock operation."
            );
          }

          const current = await repository.getInventory(rawProductId, client);
          return {
            view: repository.toInventoryView(current!),
            replay: true
          };
        }

        const updated = await repository.updateStock(
          rawProductId,
          quantity,
          operation,
          client
        );

        const view = repository.toInventoryView(updated);

        // Outbox: el StockChanged se confirma junto con el cambio de stock.
        await publisher.publishStockChanged(rawProductId, view, correlationId, client);

        return { view, replay: false };
      });

      res.status(200).json(result.view);

    }
    catch (error) {
      next(error);
    }

  }

  /**
   * POST /inventory/sync-catalog
   * Integracion REST con G3: crea la fila de inventario de cada
   * producto del catalogo que aun no exista (idempotente).
   */
  async syncCatalog(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const correlationId = req.headers["x-correlation-id"] as string;

      const result = await catalogSyncService.syncCatalog(correlationId);

      res.status(200).json(result);

    }
    catch (error) {
      next(error);
    }

  }

  /**
   * POST /inventory/reserve
   */
  async reserve(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const idempotencyKey = req.header("Idempotency-Key");
      const correlationId = req.headers["x-correlation-id"] as string;

      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new ApiError(
          400,
          "MISSING_IDEMPOTENCY_KEY",
          "Idempotency-Key header is required."
        );
      }

      const { orderId, items } = req.body;

      const result = await reservationService.reserveStock({
        orderId,
        idempotencyKey,
        items,
        correlationId
      });

      const statusCode = result.isIdempotentReplay ? 200 : 201;

      res.status(statusCode).json(result.reservation);

    }
    catch (error) {
      next(error);
    }

  }

  /**
   * POST /inventory/confirm
   */
  async confirmReservation(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const { orderId } = req.body;
      const correlationId = req.headers["x-correlation-id"] as string;

      if (!orderId || typeof orderId !== "string" || orderId.trim().length === 0) {
        throw new ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
      }

      const reservation = await reservationService.confirmReservation(
        orderId,
        correlationId
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
  async releaseReservation(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const { orderId } = req.body;
      const correlationId = req.headers["x-correlation-id"] as string;

      if (!orderId || typeof orderId !== "string" || orderId.trim().length === 0) {
        throw new ApiError(400, "INVALID_ORDER_ID", "orderId is required.");
      }

      const reservation = await reservationService.releaseReservation(
        orderId,
        correlationId
      );

      res.status(200).json(reservation);

    }
    catch (error) {
      next(error);
    }

  }
}

export const inventoryController = new InventoryController();
