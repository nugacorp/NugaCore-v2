// ====================================================================
// Paginación estándar para listados API (escalabilidad).
// ====================================================================

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const rawLimit = Number.parseInt(String(query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function paginateArray<T>(items: T[], params: PaginationParams): PaginatedResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / params.limit));
  const slice = items.slice(params.offset, params.offset + params.limit);
  return {
    items: slice,
    page: params.page,
    limit: params.limit,
    total,
    totalPages,
    hasMore: params.page < totalPages,
  };
}

/** Si page/limit no vienen en query, devuelve null (compat: lista completa). */
export function parsePaginationOptional(query: Record<string, unknown>): PaginationParams | null {
  if (query.page === undefined && query.limit === undefined) return null;
  return parsePagination(query);
}
