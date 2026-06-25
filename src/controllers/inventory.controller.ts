import { Request, Response, NextFunction } from "express";
import { reservationService } from "../domain/reservations";
import { repository } from "../repository/repository";
import { ApiError } from "../middlewares/error.middleware";

export class InventoryController {

  /**
   * GET /inventory
   */
  getInventory(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {

    try {

      const page =
        Number(req.query.page ?? 1);

      const size =
        Number(req.query.size ?? 20);

      if (
        page < 1 ||
        size < 1 ||
        size > 100
      ) {
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Invalid pagination parameters."
        );
      }

      const inventory =
        repository.listInventory();

      const start =
        (page - 1) * size;

      const data =
        inventory
          .slice(start, start + size)
          .map(item =>
            repository.toInventoryView(item)
          );

      res.status(200).json({
        data,
        pagination: {
          page,
          size,
          total: inventory.length,
          totalPages: Math.ceil(
            inventory.length / size
          )
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
  getInventoryByProductId(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {

    try {

      const rawProductId = req.params.productId;

      if (
        !rawProductId ||
        Array.isArray(rawProductId)
      ) {
        throw new ApiError(
          400,
          "INVALID_PRODUCT_ID",
          "Product ID is required."
        );
      }

      const inventory =
        repository.getInventory(rawProductId);

      if (!inventory) {
        throw new ApiError(
          404,
          "PRODUCT_NOT_FOUND",
          "Product not found."
        );
      }

      res.status(200).json(
        repository.toInventoryView(inventory)
      );

    }
    catch (error) {
      next(error);
    }

  }

  /**
   * GET /inventory/:productId/stock
   */
  getStock(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {

    this.getInventoryByProductId(
      req,
      res,
      next
    );

  }

  /**
   * POST /inventory/:productId/stock
   */
  setStock(
  req: Request,
  res: Response,
  next: NextFunction
): void {

  try {

    const idempotencyKey =
      req.header("Idempotency-Key");

    if (
      !idempotencyKey ||
      idempotencyKey.trim().length === 0
    ) {
      throw new ApiError(
        400,
        "MISSING_IDEMPOTENCY_KEY",
        "Idempotency-Key header is required."
      );
    }

    const rawProductId = req.params.productId;

    if (
      !rawProductId ||
      Array.isArray(rawProductId)
    ) {
      throw new ApiError(
        400,
        "INVALID_PRODUCT_ID",
        "Product ID is required."
      );
    }

    const { quantity, operation } = req.body;

    if (
      typeof quantity !== "number" ||
      quantity < 0
    ) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        "Quantity must be a number greater than or equal to 0."
      );
    }

    if (
      operation !== "SET" &&
      operation !== "ADD"
    ) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        "Operation must be SET or ADD."
      );
    }

    // ========================================
    // IDEMPOTENCIA REAL
    // Si esta key ya fue usada, devolvemos
    // la misma respuesta sin volver a tocar stock.
    // ========================================
  
  const existingRecord =
  repository.findStockIdempotencyKey(idempotencyKey);

if (existingRecord) {
  const sameRequest =
    existingRecord.productId === rawProductId &&
    existingRecord.quantity === quantity &&
    existingRecord.operation === operation;

  if (!sameRequest) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used with a different stock operation."
    );
  }

  res.status(200).json(existingRecord.response);
  return;
}

    const inventory =
      repository.getInventory(rawProductId);

    if (!inventory) {
      throw new ApiError(
        404,
        "PRODUCT_NOT_FOUND",
        "Product not found."
      );
    }

    const updatedInventory =
      repository.updateStock(
        rawProductId,
        quantity,
        operation
      );

    const response =
      repository.toInventoryView(updatedInventory);

    repository.saveStockIdempotencyKey(
      idempotencyKey,
      {
        productId: rawProductId,
        operation,
        quantity,
        response
      }
    );

    res.status(200).json(response);

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

      const idempotencyKey =
        req.header("Idempotency-Key");

      if (
        !idempotencyKey ||
        idempotencyKey.trim().length === 0
      ) {
        throw new ApiError(
          400,
          "MISSING_IDEMPOTENCY_KEY",
          "Idempotency-Key header is required."
        );
      }

      const {
        orderId,
        items
      } = req.body;

      const result =
        await reservationService.reserveStock({
          orderId,
          idempotencyKey,
          items
        });

      const statusCode =
        result.isIdempotentReplay ? 200 : 201;

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
  async confirmReservation(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {

      const { orderId } = req.body;

      if (
        !orderId ||
        typeof orderId !== "string" ||
        orderId.trim().length === 0
      ) {
        throw new ApiError(
          400,
          "INVALID_ORDER_ID",
          "orderId is required."
        );
      }

      const reservation =
        await reservationService.confirmReservation(orderId);

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

      if (
        !orderId ||
        typeof orderId !== "string" ||
        orderId.trim().length === 0
      ) {
        throw new ApiError(
          400,
          "INVALID_ORDER_ID",
          "orderId is required."
        );
      }

      const reservation =
        await reservationService.releaseReservation(orderId);

      res.status(200).json(reservation);

    }
    catch (error) {
      next(error);
    }

  }
}

export const inventoryController =
  new InventoryController();