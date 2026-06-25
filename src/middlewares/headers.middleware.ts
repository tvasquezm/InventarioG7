import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

import { ApiError } from "./error.middleware";

export function headersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {

  const requestId =
    req.header("X-Request-Id") ??
    crypto.randomUUID();

  const correlationId =
    req.header("X-Correlation-Id") ??
    crypto.randomUUID();

  const consumer =
    req.header("X-Consumer");

  if (!consumer) {
    next(
      new ApiError(
        400,
        "MISSING_HEADER",
        "Header X-Consumer is required."
      )
    );
    return;
  }

  req.headers["x-request-id"] = requestId;
  req.headers["x-correlation-id"] = correlationId;
  req.headers["x-consumer"] = consumer;

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Correlation-Id", correlationId);
  res.setHeader("X-Consumer", consumer);

  next();
}