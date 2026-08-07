// ====================================================================
// Saneado de rutas antes de escribirlas en logs o auditoría.
//
// Algunas rutas públicas llevan un identificador opaco en el path (el token
// de webhook por WISP de OpenPay). Ese token no es un secreto de firma, pero
// sí es la credencial que identifica al WISP en una URL que se comparte con
// el proveedor: no debe quedar en logs de acceso ni en la auditoría.
// ====================================================================

/** `/api/payments/webhook/<provider>/<token>` → el token se enmascara. */
const WEBHOOK_TOKEN_PATH = /^(\/api\/payments\/webhook\/[^/]+)\/[^/]+/;

export const redactSensitivePath = (path: string): string =>
  String(path ?? '').replace(WEBHOOK_TOKEN_PATH, '$1/***');

/**
 * `<tenant>/<clientId>/<uid>-INE-Juan-Perez.pdf` → `<tenant>/<clientId>/***`.
 *
 * El nombre de archivo del expediente lo elige quien sube el documento y suele
 * llevar el nombre del titular o el tipo de identificación: es dato personal y
 * no tiene por qué acabar en un log. El prefijo sí se conserva, porque es lo
 * que permite localizar la carpeta cuando hay que limpiar un huérfano a mano.
 */
export const redactStoragePath = (path: string): string =>
  String(path ?? '').replace(/[^/]+$/, '***');
