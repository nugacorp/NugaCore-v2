// Comparación semántica de payloads idempotentes.
//
// Postgres JSONB no considera significativo el orden de las claves. El Store
// debe ofrecer la misma semántica, incluso en objetos anidados, para que una
// reentrega equivalente no se convierta en un falso conflicto.

const normalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, normalizeJson(source[key])]),
    );
  }
  return value;
};

export const canonicalIdempotencyPayload = (value: unknown): string =>
  JSON.stringify(normalizeJson(value));

export const idempotencyPayloadsEquivalent = (a: unknown, b: unknown): boolean =>
  canonicalIdempotencyPayload(a) === canonicalIdempotencyPayload(b);

/**
 * ID determinista e inyectivo para tablas cuyo PK sigue siendo global aunque
 * la idempotencia sea tenant-scoped. El prefijo de longitud evita ambigüedades
 * si tenant o key contienen el mismo separador.
 */
export const tenantScopedIdempotencyId = (
  prefix: string,
  tenantId: string,
  idempotencyKey: string,
): string => `${prefix}-${tenantId.length}:${tenantId}:${idempotencyKey}`;
