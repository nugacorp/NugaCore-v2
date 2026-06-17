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

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from './logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'APP_ERROR',
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

/** 404 JSON para endpoints /api no encontrados (se monta tras las rutas). */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: 'Endpoint not found', code: 'ENDPOINT_NOT_FOUND', path: req.path });
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

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error('AppError', {
        code: err.code,
        message: err.message,
        path: req.path,
        method: req.method,
        requestId: req.requestId,
      });
    }
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  log.error('Unhandled exception', {
    message,
    path: req.path,
    method: req.method,
    requestId: req.requestId,
  });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
};
