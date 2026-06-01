// ====================================================================
// Validadores reutilizables.
//
// Lanzan AppError(400) ante entradas inválidas, para que el errorHandler
// responda de forma consistente. Pensados para usarse en las rutas de
// escritura (alta/edición). Retro-compatibles con requireFields/toNumberOr.
// ====================================================================

import { BadRequestError } from './errors';

/** Verifica que todos los campos estén presentes y no vacíos. */
export const requireFields = (payload: Record<string, unknown>, fields: string[]): void => {
  for (const field of fields) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') {
      throw new BadRequestError(`Missing required field: ${field}`, 'MISSING_FIELD');
    }
  }
};

/** Convierte a número o devuelve el fallback si no es finito. */
export const toNumberOr = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Exige una cadena no vacía y la devuelve recortada. */
export const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`Field "${field}" must be a non-empty string`, 'INVALID_STRING');
  }
  return value.trim();
};

/** Exige un número finito dentro de un rango opcional. */
export const requireNumber = (
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestError(`Field "${field}" must be a number`, 'INVALID_NUMBER');
  }
  if (opts.min !== undefined && parsed < opts.min) {
    throw new BadRequestError(`Field "${field}" must be >= ${opts.min}`, 'NUMBER_OUT_OF_RANGE');
  }
  if (opts.max !== undefined && parsed > opts.max) {
    throw new BadRequestError(`Field "${field}" must be <= ${opts.max}`, 'NUMBER_OUT_OF_RANGE');
  }
  return parsed;
};

/** Exige que el valor pertenezca a un conjunto permitido (enum). */
export const requireEnum = <T extends string>(value: unknown, field: string, allowed: readonly T[]): T => {
  const raw = String(value ?? '').trim();
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new BadRequestError(
      `Field "${field}" must be one of: ${allowed.join(', ')}`,
      'INVALID_ENUM',
    );
  }
  return raw as T;
};

/** Validación laxa de email (suficiente para entrada de formulario). */
export const isEmail = (value: unknown): boolean =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Exige un email válido y lo devuelve normalizado. */
export const requireEmail = (value: unknown, field = 'email'): string => {
  if (!isEmail(value)) {
    throw new BadRequestError(`Field "${field}" must be a valid email`, 'INVALID_EMAIL');
  }
  return String(value).trim().toLowerCase();
};

/** Lanza BadRequestError si la condición no se cumple. */
export const assert = (condition: unknown, message: string, code = 'VALIDATION_FAILED'): void => {
  if (!condition) {
    throw new BadRequestError(message, code);
  }
};
