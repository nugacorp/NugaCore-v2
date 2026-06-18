// ====================================================================
// Correlation ID por petición (checklist §14).
//
// - Lee X-Request-Id entrante (saneado) o genera un UUID.
// - Lo expone en req.requestId, en un child logger (req.log) y en la
//   cabecera de respuesta X-Request-Id para correlacionar extremo a extremo.
// - Cuenta peticiones, 4xx, 5xx y latencia en el evento 'finish' (captura
//   TODO error de estado, venga o no del errorHandler).
//
// El valor entrante se sanea (allowlist de caracteres) para evitar inyección
// en logs/cabeceras.
// ====================================================================

import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { logger } from './logger';
import { metrics } from './metrics';

const HEADER = 'x-request-id';
const isSafeId = (value: string): boolean => /^[A-Za-z0-9._-]{1,128}$/.test(value);

export const attachRequestId = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.headers[HEADER];
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = raw && isSafeId(raw) ? raw : randomUUID();

  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.countRequest();
    metrics.observeLatency(durationMs);
    if (res.statusCode >= 500) metrics.count5xx();
    else if (res.statusCode >= 400) metrics.count4xx();
  });

  next();
};
