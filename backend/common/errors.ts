import { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Endpoint not found' });
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  logger.error('Unhandled exception', { message });
  res.status(500).json({ error: 'Internal server error' });
};
