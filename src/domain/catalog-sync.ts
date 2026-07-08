// ======================================================
// Catalog Sync - Sincroniza catalogo (G3) -> inventario (G7)
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================
//
// Automatiza lo que en E3 se hacia a mano (seed con los UUID del
// catalogo): recorre GET /products de G3 y crea la fila de inventario
// de cada producto que aun no exista.
//
// Reglas:
// - Producto nuevo: se crea con available_stock = stock_visible del
//   catalogo (mismo criterio del seed: catalogo e inventario parten
//   coherentes; despues la verdad del stock es esta BD).
// - Producto ya inventariado: NO se toca (el INSERT es ON CONFLICT
//   DO NOTHING). Re-ejecutar la sincronizacion es idempotente.
// - Producto inactivo en el catalogo: se omite.

import { catalogClient } from "../clients/catalog.client";
import { repository } from "../repository/repository";

export interface CatalogSyncResult {
  catalogProducts: number;
  created: number;
  alreadyTracked: number;
  skippedInactive: number;
  createdProducts: { productId: string; name: string; initialStock: number }[];
}

export class CatalogSyncService {

  async syncCatalog(correlationId: string): Promise<CatalogSyncResult> {

    const products = await catalogClient.getAllProducts(correlationId);

    const result: CatalogSyncResult = {
      catalogProducts: products.length,
      created: 0,
      alreadyTracked: 0,
      skippedInactive: 0,
      createdProducts: []
    };

    const now = new Date();

    for (const product of products) {

      if (!product.isActive) {
        result.skippedInactive++;
        continue;
      }

      const exists = await repository.existsInventory(product.id);
      if (exists) {
        result.alreadyTracked++;
        continue;
      }

      await repository.createInventory({
        productId: product.id,
        availableStock: product.stockVisible ?? 0,
        reservedStock: 0,
        version: 1,
        createdAt: now,
        updatedAt: now
      });

      result.created++;
      result.createdProducts.push({
        productId: product.id,
        name: product.name,
        initialStock: product.stockVisible ?? 0
      });
    }

    console.log(
      `[catalog-sync] correlationId=${correlationId} ` +
      `catalogo=${result.catalogProducts} creados=${result.created} ` +
      `existentes=${result.alreadyTracked} inactivos=${result.skippedInactive}`
    );

    return result;
  }

}

export const catalogSyncService = new CatalogSyncService();
