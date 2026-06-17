// ====================================================================
// Correlation ID por petición (checklist §14).
//
// - Lee X-Request-Id entrante (saneado) o genera un UUID.
// - Lo expone en req.requestId, en un child logger (req.log) y en la
//   cabecera de respuesta X-Request-Id para correlacionar extremo a extremo.
// - Cuenta peticiones y 5xx en el evento 'finish' (captura TODO 5xx, venga
//   o no del errorHandler).
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

  res.on('finish', () => {
    metrics.countRequest();
    if (res.statusCode >= 500) metrics.count5xx();
  });

  next();
};
