// ====================================================================
// Manejo global de errores.
//
// - `AppError` y subclases tipadas con statusCode + code semántico.
// - `errorHandler`: middleware final; respuesta JSON consistente { error, code }.
// - `notFoundHandler`: 404 JSON para rutas /api no encontradas.
// - `asyncHandler`: envuelve handlers async para que sus rechazos lleguen
//   al errorHandler (Express 4 no captura promesas rechazadas).
//
// Retro-compatible: se conservan AppError, notFoundHandler y errorHandler.
// Los logs 5xx incluyen requestId (correlation) cuando está disponible.
// ====================================================================

import { createHash } from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from './logger';
import { redactSensitivePath } from './log-redaction';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'APP_ERROR',
    /** Contexto estructurado para el cliente (motivos, avisos). Nunca secretos. */
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(400, message, code);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(401, message, code);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(403, message, code);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(404, message, code);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(409, message, code);
    this.name = 'ConflictError';
  }
}

/**
 * Misma clave de idempotencia con un payload/propietario distinto. Es un fallo
 * DETERMINISTA de integridad, no una carrera: reintentarlo dentro del handler
 * volvería a fallar, así que nunca debe confundirse con la pérdida de un claim
 * ni con un error transitorio de base de datos. Requiere intervención.
 */
export class IdempotencyConflictError extends AppError {
  public readonly fingerprint: string;

  constructor(
    public readonly scope: string,
    idempotencyKey: string,
    message = `Conflicto de idempotencia en ${scope}: la clave ya existe con otro contenido.`,
  ) {
    super(409, message, 'IDEMPOTENCY_CONFLICT');
    this.name = 'IdempotencyConflictError';
    this.fingerprint = opaqueFingerprint(idempotencyKey);
  }
}

/** Fingerprint correlacionable que no conserva ni expone la identidad original. */
export const opaqueFingerprint = (identity: string): string =>
  createHash('sha256').update(identity).digest('hex').slice(0, 16);

/** Dependencia o capacidad no disponible: el llamador debe reintentar. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(503, message, code);
    this.name = 'ServiceUnavailableError';
  }
}

/** Una colisión unique no pudo releerse de forma segura; es retryable y redactada. */
export class IdempotencyResolutionError extends ServiceUnavailableError {
  public readonly fingerprint: string;

  constructor(public readonly scope: string, idempotencyKey: string) {
    super(
      `No fue posible resolver de forma segura una escritura idempotente en ${scope}.`,
      'IDEMPOTENCY_RESOLUTION_UNAVAILABLE',
    );
    this.name = 'IdempotencyResolutionError';
    this.fingerprint = opaqueFingerprint(idempotencyKey);
  }
}

/** 404 JSON para endpoints /api no encontrados (se monta tras las rutas). */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
    path: redactSensitivePath(req.path),
  });
};

/** Envuelve un handler async para canalizar sus errores al errorHandler. */
export const asyncHandler = (fn: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const log = req.log ?? logger;
  const safePath = redactSensitivePath(req.path);

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error('AppError', {
        code: err.code,
        message: err.message,
        path: safePath,
        method: req.method,
        requestId: req.requestId,
      });
    }
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message || 'Unexpected server error')
        : 'Unexpected server error';
  log.error('Unhandled exception', {
    message,
    path: safePath,
    method: req.method,
    requestId: req.requestId,
  });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
};
