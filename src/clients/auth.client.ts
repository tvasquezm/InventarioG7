// ======================================================
// Auth Client - Integracion REST con G2 (Identidad)
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================

import crypto from "crypto";
import { ApiError } from "../middlewares/error.middleware";

// URL publica del Identity Service de G2 (Supabase Auth detras).
const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL ||
  "https://auth-minimarket-cloud.onrender.com";

// Render free duerme el servicio: timeout generoso por el cold start.
const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS || 60000);

export interface AuthenticatedUser {
  userId: string;
  businessUserId: string | null;
  email: string;
  role: string;
  status: string;
}

export class AuthClient {

  /**
   * GET /auth/validate de G2: valida el access token y devuelve la
   * identidad y rol vigentes del usuario.
   *
   * Mapeo de respuestas (contrato de G2):
   * - 200 -> usuario valido (con role y status).
   * - 401 -> token ausente/invalido/expirado.
   * - 403 -> token valido pero cuenta deshabilitada.
   * - G2 caido/timeout -> 502/504 (fail closed: sin G2 no se autoriza).
   */
  async validate(
    token: string,
    correlationId: string
  ): Promise<AuthenticatedUser> {

    let response: Response;
    try {
      response = await fetch(`${AUTH_BASE_URL}/auth/validate`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Request-Id": crypto.randomUUID(),
          "X-Correlation-Id": correlationId,
          "X-Consumer": "inventory-service"
        },
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
      });
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new ApiError(
          504,
          "AUTH_TIMEOUT",
          `Identity service (G2) did not respond within ${AUTH_TIMEOUT_MS}ms.`
        );
      }
      throw new ApiError(
        502,
        "AUTH_UNAVAILABLE",
        "Identity service (G2) is unreachable."
      );
    }

    if (response.status === 401) {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "Access token is missing, invalid or expired."
      );
    }

    if (response.status === 403) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "User account is disabled."
      );
    }

    if (!response.ok) {
      throw new ApiError(
        502,
        "AUTH_ERROR",
        `Identity service (G2) responded HTTP ${response.status}.`
      );
    }

    const body: any = await response.json();

    return {
      userId: body.user_id,
      businessUserId: body.business_user_id ?? null,
      email: body.email,
      role: body.role,
      status: body.status
    };
  }

}

export const authClient = new AuthClient();
