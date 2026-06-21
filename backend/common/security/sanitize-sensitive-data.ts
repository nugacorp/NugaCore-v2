// ====================================================================
// PROD-1 — Sanitización profunda de datos sensibles (security hotfix).
//
// Punto ÚNICO de saneo para datos libres provenientes del cliente antes de
// persistirlos o devolverlos por API (payload, notes, reason, description,
// detalles de auditoría). Toda redacción del dominio Manual Safe Mode pasa
// por aquí: NO duplicar esta lógica en services/mappers.
//
// Reglas:
//   - Redacción recursiva por NOMBRE de clave (objetos, arrays, anidados).
//   - Detección de bloques de script RouterOS en strings.
//   - Redacción de secretos embebidos en texto libre (key=valor, Bearer, JWT).
//
// Marcadores (contractuales):
//   [REDACTED]                  → valor sensible.
//   [REDACTED_ROUTEROS_SCRIPT]  → string que parece un script RouterOS.
//
// Distinto de `common/secret-redaction.ts` (que sanea LOGS con otro marcador).
// ====================================================================

export const REDACTED = '[REDACTED]';
export const REDACTED_ROUTEROS_SCRIPT = '[REDACTED_ROUTEROS_SCRIPT]';

// Núcleos de clave sensible, normalizados (lowercase, sin _ - ni espacios).
// La coincidencia es por substring para cubrir variantes camelCase y snake_case
// (p.ej. accessToken/access_token → "token"; clientSecret/client_secret → "secret").
const SENSITIVE_KEY_CORES = [
  'password',
  'secret',
  'token',
  'authorization',
  'privatekey',
  'presharedkey',
  'credential', // cubre "credentials"
  'servicerole',
  'jwt',
  'bearer',
  'apikey',
];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');

/** ¿La clave de un objeto debe redactarse por completo? */
export const isSensitiveKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_CORES.some((core) => normalized.includes(core));
};

// Patrones de bloques de script RouterOS (lista del spec + variantes seguras).
const ROUTEROS_PATTERNS: RegExp[] = [
  /\/system\b/i,
  /\/ip\s+firewall/i,
  /\/interface\s+wireguard/i,
  /\/ppp\s+secret/i,
  /\/user\s+add/i,
  /\/interface\s+\S+\s+(add|set|enable|disable)/i,
  /\/ip\s+\S+\s+(add|set)/i,
];

/** ¿El string parece un script / bloque de comandos RouterOS? */
export const looksLikeRouterOsScript = (text: string): boolean =>
  ROUTEROS_PATTERNS.some((re) => re.test(text));

// Marcador sentinel de Hermes: cualquier string que lo contenga se redacta entero.
const SENTINEL_MARKER = /PROD1_SENTINEL_/i;

// Asignación de un secreto en texto libre: `claveSensible = valor` o `... : valor`.
const SENSITIVE_ASSIGNMENT =
  /\b(pass(?:word|wd)?|pwd|secret|tokens?|access[-_]?token|refresh[-_]?token|authorization|auth[-_]?token|private[-_]?key|preshared[-_]?key|api[-_]?key|client[-_]?secret|service[-_]?role|credentials?|jwt|bearer)\b\s*[:=]/i;

// `Bearer <token>` y JWT sueltos (eyJ....eyJ....sig).
const BEARER_TOKEN = /\bBearer\s+\S/i;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/** ¿El texto libre contiene algún indicio sensible (clave, sentinel, Bearer, JWT)? */
export const containsSensitiveText = (text: string): boolean =>
  SENTINEL_MARKER.test(text) ||
  SENSITIVE_ASSIGNMENT.test(text) ||
  BEARER_TOKEN.test(text) ||
  JWT_TOKEN.test(text);

/**
 * Sanea un string libre. Postura conservadora: si el texto parece un script
 * RouterOS o contiene CUALQUIER indicio sensible (clave sensible, sentinel,
 * Bearer, JWT), se redacta COMPLETO. No se intenta preservar partes sensibles.
 */
export const sanitizeText = (text: string): string => {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (looksLikeRouterOsScript(text)) return REDACTED_ROUTEROS_SCRIPT;
  if (containsSensitiveText(text)) return REDACTED;
  return text;
};

/**
 * Sanea recursivamente cualquier valor (objetos, arrays, objetos anidados,
 * arrays de objetos). Las claves sensibles se redactan por completo; los
 * strings se pasan por `sanitizeText`. Tolerante a ciclos.
 */
export const sanitizeSensitiveData = <T>(value: T): T =>
  sanitizeValue(value, new WeakSet()) as T;

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(val, seen);
  }
  return out;
}
