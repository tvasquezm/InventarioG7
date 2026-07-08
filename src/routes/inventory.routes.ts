import { Router } from "express";

import { inventoryController } from "../controllers/inventory.controller";
import { requireAdmin } from "../middlewares/auth.middleware";

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
 * Protegido: exige JWT con rol admin, validado contra G2 (contrato v1.1).
 */
router.post(
  "/inventory/:productId/stock",
  requireAdmin,
  inventoryController.setStock.bind(inventoryController)
);

/**
 * POST /inventory/sync-catalog (integracion con G3)
 */
router.post(
  "/inventory/sync-catalog",
  inventoryController.syncCatalog.bind(inventoryController)
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