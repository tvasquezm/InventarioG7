import { Router } from "express";

import { inventoryController } from "../controllers/inventory.controller";

const router = Router();

/**
 * GET /inventory
 */
router.get(
  "/inventory",
  inventoryController.getInventory.bind(inventoryController)
);

/**
 * GET /inventory/:productId
 */
router.get(
  "/inventory/:productId",
  inventoryController.getInventoryByProductId.bind(inventoryController)
);

/**
 * GET /inventory/:productId/stock
 */
router.get(
  "/inventory/:productId/stock",
  inventoryController.getStock.bind(inventoryController)
);

/**
 * POST /inventory/:productId/stock
 */
router.post(
  "/inventory/:productId/stock",
  inventoryController.setStock.bind(inventoryController)
);

/**
 * POST /inventory/reserve
 */
router.post(
  "/inventory/reserve",
  inventoryController.reserve.bind(inventoryController)
);

/**
 * POST /inventory/confirm
 */
router.post(
  "/inventory/confirm",
  inventoryController.confirmReservation.bind(inventoryController)
);

/**
 * POST /inventory/release
 */
router.post(
  "/inventory/release",
  inventoryController.releaseReservation.bind(inventoryController)
);

export default router;