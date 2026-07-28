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
