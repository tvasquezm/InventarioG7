"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_controller_1 = require("../controllers/inventory.controller");
const router = (0, express_1.Router)();
/**
 * GET /inventory
 */
router.get("/inventory", inventory_controller_1.inventoryController.getInventory.bind(inventory_controller_1.inventoryController));
/**
 * GET /inventory/:productId
 */
router.get("/inventory/:productId", inventory_controller_1.inventoryController.getInventoryByProductId.bind(inventory_controller_1.inventoryController));
/**
 * GET /inventory/:productId/stock
 */
router.get("/inventory/:productId/stock", inventory_controller_1.inventoryController.getStock.bind(inventory_controller_1.inventoryController));
/**
 * POST /inventory/:productId/stock
 */
router.post("/inventory/:productId/stock", inventory_controller_1.inventoryController.setStock.bind(inventory_controller_1.inventoryController));
/**
 * POST /inventory/reserve
 */
router.post("/inventory/reserve", inventory_controller_1.inventoryController.reserve.bind(inventory_controller_1.inventoryController));
/**
 * POST /inventory/confirm
 */
router.post("/inventory/confirm", inventory_controller_1.inventoryController.confirmReservation.bind(inventory_controller_1.inventoryController));
/**
 * POST /inventory/release
 */
router.post("/inventory/release", inventory_controller_1.inventoryController.releaseReservation.bind(inventory_controller_1.inventoryController));
exports.default = router;
//# sourceMappingURL=inventory.routes.js.map