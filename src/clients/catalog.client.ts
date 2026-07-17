// ======================================================
// Catalog Client - Integracion REST con G3 (Catalogo)
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================

import crypto from "crypto";
import { ApiError } from "../middlewares/error.middleware";

// URL publica del catalogo de G3 (mock desplegado en Render free).
// Se puede sobreescribir por entorno sin tocar codigo.
const CATALOG_BASE_URL =
  process.env.CATALOG_BASE_URL ||
  "https://catalog-api-cm1l.onrender.com/api/v1";

// Render free duerme el servicio: el cold start puede tardar ~30s,
// por eso el timeout por defecto es generoso.
const CATALOG_TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS || 60000);

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  stockVisible: number;
  isActive: boolean;
}

interface CatalogPage {
  products: CatalogProduct[];
  totalPages: number;
  totalElements: number;
}

// Fila del catalogo -> objeto propio. G3 ha cambiado el casing de su
// respuesta entre versiones (snake_case y camelCase, incluso distinto
// por endpoint), asi que se aceptan ambas formas.
function mapProduct(p: any): CatalogProduct {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    stockVisible: p.stockVisible ?? p.stock_visible,
    isActive: p.isActive ?? p.is_active
  };
}

export class CatalogClient {

  /**
   * GET al catalogo con los headers obligatorios del curso
   * (X-Request-Id, X-Correlation-Id, X-Consumer: sin ellos G3 responde 400).
   * Propaga el correlationId del flujo para trazabilidad entre servicios.
   */
  private async get(path: string, correlationId: string): Promise<any> {

    const url = `${CATALOG_BASE_URL}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "X-Request-Id": crypto.randomUUID(),
          "X-Correlation-Id": correlationId,
          "X-Consumer": "inventory-service"
        },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
      });
    } catch (err: any) {
      // Timeout o red caida: el catalogo no respondio.
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new ApiError(
          504,
          "CATALOG_TIMEOUT",
          `Catalog service (G3) did not respond within ${CATALOG_TIMEOUT_MS}ms.`
        );
      }
      throw new ApiError(
        502,
        "CATALOG_UNAVAILABLE",
        "Catalog service (G3) is unreachable."
      );
    }

    if (response.status === 404) {
      throw new ApiError(
        404,
        "PRODUCT_NOT_FOUND",
        "Product not found in catalog (G3)."
      );
    }

    if (!response.ok) {
      throw new ApiError(
        502,
        "CATALOG_ERROR",
        `Catalog service (G3) responded HTTP ${response.status}.`
      );
    }

    return response.json();
  }

  /**
   * GET /products?page=&size= — una pagina del catalogo.
   */
  async getProductsPage(
    page: number,
    size: number,
    correlationId: string
  ): Promise<CatalogPage> {
    const body = await this.get(
      `/products?page=${page}&size=${size}`,
      correlationId
    );
    return {
      products: (body.data ?? []).map(mapProduct),
      totalPages: body.meta?.totalPages ?? 1,
      totalElements: body.meta?.totalElements ?? 0
    };
  }

  /**
   * Recorre todas las paginas del catalogo y devuelve el listado completo.
   */
  async getAllProducts(correlationId: string): Promise<CatalogProduct[]> {

    const size = 50;
    const first = await this.getProductsPage(1, size, correlationId);
    const all = [...first.products];

    for (let page = 2; page <= first.totalPages; page++) {
      const next = await this.getProductsPage(page, size, correlationId);
      all.push(...next.products);
    }

    return all;
  }

  /**
   * GET /products/{id} — detalle de un producto del catalogo.
   */
  async getProduct(
    productId: string,
    correlationId: string
  ): Promise<CatalogProduct> {
    const body = await this.get(`/products/${productId}`, correlationId);
    return mapProduct(body);
  }

}

export const catalogClient = new CatalogClient();
