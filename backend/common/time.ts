// ====================================================================
// Utilidades de tiempo compartidas (ARCH-1).
//
// Antes existian ~12 definiciones locales identicas de `nowIso` repartidas
// por los dominios. Se centralizan aqui (extraccion de utilidad comun, sin
// cambio de comportamiento: la implementacion es identica).
// ====================================================================

/** Timestamp ISO-8601 en UTC (equivalente a `new Date().toISOString()`). */
export const nowIso = (): string => new Date().toISOString();
