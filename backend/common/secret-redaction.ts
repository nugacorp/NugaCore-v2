// ====================================================================
// Redacción central de secretos (Fase 4.4.1 — hardening MikroTik).
//
// Punto único para sanear cualquier texto/objeto antes de loguearlo,
// persistirlo en auditoría o tomar snapshots. Cubre:
//   - passwords (api, vpn, genéricos)  → password=****REDACTED****
//   - provisioning tokens / secrets    → token=****REDACTED****
//   - JWT / Bearer                     → Bearer ****REDACTED****
//   - service-role / encryption keys / credential blobs (por nombre de clave)
//
// NO redacta `public-key` (WireGuard) porque es público por diseño.
// ====================================================================

export const REDACTED = '****REDACTED****';

// Nombres de propiedad que SIEMPRE deben redactarse en objetos.
// (incluye encryptedPassword/plainPassword: ni siquiera el blob cifrado se loguea)
const SECRET_KEY_REGEX =
  /(pass(word|wd)?|pwd|secret|token|jwt|bearer|authorization|auth[-_]?token|service[-_]?role|encryption[-_]?key|encrypted[-_]?password|plain[-_]?password|credential|api[-_]?key|private[-_]?key)/i;

/** Colapsa un secreto crudo conocido a la marca de redacción. */
export function redactSecret(value?: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return REDACTED;
}

/**
 * Redacta secretos embebidos en un texto libre (líneas de log, mensajes,
 * scripts RouterOS). Conserva `public-key` y demás material no sensible.
 */
export function redactString(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;

  // password / passwd / pwd = "X" | 'X' | X   (evita capturar `public-key`)
  out = out.replace(
    /(\bpass(?:word|wd)?\b\s*=\s*)("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
    `$1${REDACTED}`,
  );

  // token / provisioning-token / secret = ...
  out = out.replace(
    /(\b(?:provisioning[-_]?token|token|secret)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
    `$1${REDACTED}`,
  );

  // Bearer <token>
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);

  // JWT suelto (eyJ....eyJ....sig)
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED);

  return out;
}

/** Especialización para scripts RouterOS (alias semántico de redactString). */
export function redactScript(script: string): string {
  return redactString(script);
}

/**
 * Clona en profundidad redactando: (1) valores cuyas claves parezcan secretas,
 * (2) secretos embebidos en valores string. Tolerante a ciclos.
 */
export function redactObject<T>(input: T): T {
  return redactValue(input, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_REGEX.test(key)) {
      out[key] = val === undefined || val === null || val === '' ? val : REDACTED;
    } else {
      out[key] = redactValue(val, seen);
    }
  }
  return out;
}
