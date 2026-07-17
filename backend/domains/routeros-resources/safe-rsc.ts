// ====================================================================
// Utilidades de seguridad para el generador de recursos RouterOS.
// Redacta secretos para summaries y vista previa saneada.
// ====================================================================

/** Enmascara un secreto para logs o vista previa. */
export const maskSecret = (value: string): string => {
  if (!value) return '';
  if (value.length <= 6) return '••••••';
  return `${value.substring(0, 3)}${'•'.repeat(value.length - 6)}${value.substring(value.length - 3)}`;
};

/**
 * Genera una versión saneada del script con los secretos reemplazados por
 * marcadores de posición. Segura para mostrar en la UI como vista previa.
 */
export const sanitizeScriptForPreview = (script: string): string => {
  let sanitized = script;
  sanitized = sanitized.replace(/(password=")[^"]+(")/gi, '$1••••••••$2');
  sanitized = sanitized.replace(/(private-key=")[^"]+(")/gi, '$1<PRIVATE_KEY_OMITIDA_EN_PREVIEW>$2');
  sanitized = sanitized.replace(/(password=[^\s"\\]+)/gi, 'password=••••••••');
  return sanitized;
};

/** Nombre corto para descarga /import (nc-wg-chr.rsc). */
export { buildTemplateFilename as buildFilename } from '../routeros-templates/rsc-filename';

/** Verifica que el script no contiene branding externo prohibido. */
export const assertNoBrandViolation = (script: string): void => {
  // Misma política que routeros-templates/validators: ignorar secretos opacos.
  const scrubbed = script
    .replace(/\bpassword="[^"]*"/gi, 'password=""')
    .replace(/\bprivate-key="[^"]*"/gi, 'private-key=""')
    .replace(/\bpreshared-key="[^"]*"/gi, 'preshared-key=""')
    .replace(/\bpsk="[^"]*"/gi, 'psk=""')
    .replace(/\bsecret="[^"]*"/gi, 'secret=""')
    .replace(/\bpassword=[^\s"\\]+/gi, 'password=REDACTED');
  const violations = ['livaur', 'wisphub', 'uisp', '@livaur', 'livaur.com', 'sgcm', 'whmcs'];
  const lower = scrubbed.toLowerCase();
  for (const v of violations) {
    if (lower.includes(v)) {
      throw new Error(`script-generator: branding externo detectado: "${v}"`);
    }
  }
};

/** Verifica que el script no contiene políticas prohibidas. */
export const assertNoForbiddenPolicies = (script: string): void => {
  const forbidden = ['sniff', 'sensitive', 'romon'];
  for (const p of forbidden) {
    // Busca la política dentro de policy="..." para evitar falsos positivos
    const policyBlockMatch = script.match(/policy="([^"]+)"/gi);
    if (policyBlockMatch) {
      for (const block of policyBlockMatch) {
        const policies = block
          .replace(/policy="/gi, '')
          .replace(/"/, '')
          .split(',')
          .map((s) => s.trim());
        if (policies.includes(p)) {
          throw new Error(`script-generator: política prohibida "${p}" detectada`);
        }
      }
    }
  }
};
