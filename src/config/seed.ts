import { repository, Inventory } from "../repository/repository";

export function loadSeedData(): void {

  const now = new Date();

  const products: Inventory[] = [
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
    repository.createInventory(product);
  }

  console.log("✓ Inventory seed loaded");
}