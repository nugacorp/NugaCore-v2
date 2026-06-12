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

// Patrones que identifican líneas con secretos en scripts RouterOS.
const SECRET_PATTERNS: RegExp[] = [
  /password="[^"]+"/gi,
  /private-key="[^"]+"/gi,
  /password=[^\s\r\n]+/gi,
];

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

/** Nombre de archivo seguro para el .rsc descargable. */
export const buildFilename = (routerName: string, templateId: string): string => {
  const safe = routerName.replace(/[^a-zA-Z0-9_\-]/g, '-').substring(0, 32);
  const date = new Date().toISOString().slice(0, 10);
  return `nugacore-${templateId.replace(/_/g, '-')}-${safe}-${date}.rsc`;
};

/** Verifica que el script no contiene branding externo prohibido. */
export const assertNoBrandViolation = (script: string): void => {
  const violations = ['livaur', 'wisphub', '@livaur', 'livaur.com', 'SGCM'];
  for (const v of violations) {
    if (script.toLowerCase().includes(v.toLowerCase())) {
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
