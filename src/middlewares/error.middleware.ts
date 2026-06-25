import { Request, Response, NextFunction } from "express";

/**
 * Error personalizado del servicio.
 */
export class ApiError extends Error {

  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }

}

/**
 * Middleware global de manejo de errores.
 */
export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {

  if (err instanceof ApiError) {

    res.status(err.status).json({

      timestamp: new Date().toISOString(),

      status: err.status,

      code: err.code,

      message: err.message,

      correlationId:
        req.headers["x-correlation-id"] ?? null

    });

    return;

  }

  console.error(err);

  res.status(500).json({

    timestamp: new Date().toISOString(),

    status: 500,

    code: "INTERNAL_SERVER_ERROR",

    message: "Unexpected server error.",

    correlationId:
      req.headers["x-correlation-id"] ?? null

  });

}