import { AppError } from './errors';

export const requireFields = (payload: Record<string, unknown>, fields: string[]): void => {
  for (const field of fields) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') {
      throw new AppError(400, `Missing required field: ${field}`);
    }
  }
};

export const toNumberOr = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
