"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSeedData = loadSeedData;
const repository_1 = require("../repository/repository");
function loadSeedData() {
    const now = new Date();
    const products = [
        {
            productId: "550e8400-e29b-41d4-a716-446655440000",
            availableStock: 15,
            reservedStock: 0,
            version: 1,
            createdAt: now,
            updatedAt: now
        },
        {
            productId: "660e8400-e29b-41d4-a716-446655440111",
            availableStock: 1,
            reservedStock: 0,
            version: 1,
            createdAt: now,
            updatedAt: now
        }
    ];
    for (const product of products) {
        repository_1.repository.createInventory(product);
    }
    console.log("✓ Inventory seed loaded");
}
//# sourceMappingURL=seed.js.map