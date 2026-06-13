// ====================================================================
// Dynamic Template Parameters Engine (Fase 4.9.2) — Validadores.
//
// Valida los valores enviados por el Wizard contra el esquema de la
// plantilla, y redacta los parámetros marcados como secret (passwords
// PPPoE) para logs / auditoría / preview / vista.
// ====================================================================

import { getParameterSchema } from './registry';
import { ParameterValidationResult, TemplateParameterValues } from './types';

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

export const REDACTED = '<REDACTED>';

const isValidOctets = (ip: string): boolean =>
  ip.split('.').every((o) => {
    const n = Number(o);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });

const isIp = (v: string): boolean => IP_RE.test(v) && isValidOctets(v);

const isCidr = (v: string): boolean => {
  if (!CIDR_RE.test(v)) return false;
  const [ip, prefix] = v.split('/');
  return isValidOctets(ip) && Number(prefix) >= 0 && Number(prefix) <= 32;
};

const isPresent = (raw: unknown): boolean =>
  raw !== undefined && raw !== null && raw !== '';

/**
 * Valida los valores contra el esquema de la plantilla.
 * Si la plantilla no tiene esquema, solo acepta values vacíos.
 */
export function validateTemplateParameters(
  templateId: string,
  values: TemplateParameterValues | undefined | null,
): ParameterValidationResult {
  const errors: string[] = [];
  const schema = getParameterSchema(templateId);

  if (!schema) {
    if (values && Object.keys(values).length > 0) {
      errors.push(`La plantilla '${templateId}' no admite parámetros dinámicos.`);
    }
    return { valid: errors.length === 0, errors };
  }

  const v = values ?? {};

  for (const group of schema.groups) {
    const groupValues: Record<string, unknown> = group.nested
      ? ((v[group.id] as Record<string, unknown> | undefined) ?? {})
      : v;

    for (const p of group.parameters) {
      const raw = groupValues[p.id];
      const where = group.nested ? `${group.label} › ${p.label}` : p.label;

      if (p.required && !isPresent(raw)) {
        errors.push(`${where} es requerido.`);
        continue;
      }
      if (!isPresent(raw)) continue;

      switch (p.type) {
        case 'number':
          if (isNaN(Number(raw))) errors.push(`${where} debe ser numérico.`);
          break;
        case 'boolean':
          if (typeof raw !== 'boolean') errors.push(`${where} debe ser booleano (true/false).`);
          break;
        case 'ip':
          if (!isIp(String(raw))) errors.push(`${where} debe ser una IP válida.`);
          break;
        case 'cidr':
          if (!isCidr(String(raw))) errors.push(`${where} debe ser un CIDR válido (IP/máscara).`);
          break;
        case 'select':
          if (p.options && !p.options.some((o) => o.value === String(raw))) {
            errors.push(`${where} tiene un valor no permitido.`);
          }
          break;
      }
    }

    // Regla condicional: WAN en modo estática requiere gateway.
    if (group.nested && /^wan\d+$/.test(group.id)) {
      const gv = (v[group.id] as Record<string, unknown> | undefined) ?? {};
      if (String(gv.mode) === 'static' && !isPresent(gv.gateway)) {
        errors.push(`${group.label} › Gateway es requerido en modo estática.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Devuelve una copia de los valores con los parámetros secret redactados.
 * Úsese para logs, auditoría, scriptPreview y la vista del enrollment.
 * NUNCA muta el original.
 */
export function redactSecretValues(
  templateId: string,
  values: TemplateParameterValues | undefined | null,
): TemplateParameterValues {
  if (!values) return {};
  const schema = getParameterSchema(templateId);
  const clone: TemplateParameterValues = JSON.parse(JSON.stringify(values));
  if (!schema) return clone;

  for (const group of schema.groups) {
    const secretIds = group.parameters.filter((p) => p.secret).map((p) => p.id);
    if (secretIds.length === 0) continue;

    if (group.nested) {
      const gv = clone[group.id];
      if (gv && typeof gv === 'object') {
        for (const id of secretIds) {
          if (id in (gv as Record<string, unknown>) && isPresent((gv as Record<string, unknown>)[id])) {
            (gv as Record<string, unknown>)[id] = REDACTED;
          }
        }
      }
    } else {
      for (const id of secretIds) {
        if (id in clone && isPresent(clone[id])) clone[id] = REDACTED;
      }
    }
  }
  return clone;
}

/**
 * Rellena los valores faltantes con los defaults del esquema.
 * Útil para el Wizard (estado inicial) y para mapeo determinista.
 */
export function applyDefaults(
  templateId: string,
  values: TemplateParameterValues | undefined | null,
): TemplateParameterValues {
  const schema = getParameterSchema(templateId);
  if (!schema) return values ?? {};
  const v: TemplateParameterValues = values ? JSON.parse(JSON.stringify(values)) : {};

  for (const group of schema.groups) {
    if (group.nested) {
      const gv = (v[group.id] as Record<string, unknown> | undefined) ?? {};
      for (const p of group.parameters) {
        if (gv[p.id] === undefined && p.defaultValue !== undefined) gv[p.id] = p.defaultValue;
      }
      v[group.id] = gv;
    } else {
      for (const p of group.parameters) {
        if (v[p.id] === undefined && p.defaultValue !== undefined) v[p.id] = p.defaultValue;
      }
    }
  }
  return v;
}
