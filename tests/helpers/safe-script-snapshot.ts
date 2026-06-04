// ====================================================================
// Helper de snapshot SEGURO para scripts MikroTik (Fase 4.4.1).
//
// Permite a Hermes comparar scripts entre fases SIN exponer secretos:
//   - password=...  → password=****REDACTED****
//   - token=...      → token=****REDACTED****
// y (por defecto) normaliza identificadores volátiles (usernames aleatorios)
// para que el snapshot sea estable entre ejecuciones.
// ====================================================================

import { redactScript } from '../../backend/common/secret-redaction';

/** Normaliza usernames aleatorios nugacore_<hex> → nugacore_<ID>. */
const normalizeVolatile = (s: string): string =>
  s.replace(/nugacore_[a-z0-9]+/gi, 'nugacore_<ID>');

export interface SafeSnapshotOptions {
  /** Normaliza identificadores volátiles para snapshots deterministas (default true). */
  normalize?: boolean;
}

export function safeScriptSnapshot(script: string, opts: SafeSnapshotOptions = {}): string {
  const redacted = redactScript(script);
  return opts.normalize === false ? redacted : normalizeVolatile(redacted);
}
