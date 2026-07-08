// ======================================================
// Auth Middleware - rol admin via G2 (contrato v1.1)
// Grupo 7 - Inventory Service - Fase 4 (E4 Integracion)
// ======================================================
//
// Protege SOLO la carga/reposicion de stock (POST /inventory/{id}/stock):
// exige Authorization: Bearer <jwt> y rol 'admin', validando el token
// contra GET /auth/validate de G2 en cada peticion.
//
// Reserva/confirmacion/liberacion NO llevan JWT (llamadas
// servicio-a-servicio de G5) y las lecturas son publicas.

import { Request, Response, NextFunction } from "express";
import { authClient } from "../clients/auth.client";
import { ApiError } from "./error.middleware";

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {

  try {

    const header = req.header("Authorization") ?? "";

    if (!header.startsWith("Bearer ") || header.slice(7).trim().length === 0) {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "Authorization header with Bearer token is required."
      );
    }

    const token = header.slice(7).trim();
    const correlationId = req.headers["x-correlation-id"] as string;

    const user = await authClient.validate(token, correlationId);

    if (user.role !== "admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Admin role is required to load or adjust stock."
      );
    }

    console.log(
      `[auth] correlationId=${correlationId} admin=${user.email} ` +
      `(${user.businessUserId ?? user.userId}) autorizado para carga de stock`
    );

    next();

  }
  catch (error) {
    next(error);
  }

}
