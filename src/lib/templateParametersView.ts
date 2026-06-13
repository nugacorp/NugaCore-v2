// ====================================================================
// Dynamic Template Parameters — helpers de frontend (Fase 4.9.2).
//
// Tipos espejo del esquema que devuelve
//   GET /api/router-templates/:id/parameters
// y helpers puros (sin React) para construir el formulario dinámico del
// Wizard, leer/escribir valores de forma inmutable y resolver visibilidad
// condicional (PPPoE / estática). Testeable sin jsdom.
// ====================================================================

export type TemplateParameterType = 'string' | 'number' | 'boolean' | 'select' | 'ip' | 'cidr';

export interface TemplateParameterOption {
  label: string;
  value: string;
}

export interface TemplateParameter {
  id: string;
  label: string;
  type: TemplateParameterType;
  required: boolean;
  defaultValue?: string | number | boolean;
  options?: TemplateParameterOption[];
  description?: string;
  secret?: boolean;
}

export interface TemplateParameterGroup {
  id: string;
  label: string;
  nested: boolean;
  parameters: TemplateParameter[];
}

export interface TemplateParameterSchema {
  templateId: string;
  templateName: string;
  groups: TemplateParameterGroup[];
}

export type TemplateParameterValues = Record<string, unknown>;

// ── Construcción de valores iniciales ───────────────────────────────────

/** Valores iniciales a partir de los defaults del esquema. */
export function buildDefaultParameterValues(schema: TemplateParameterSchema): TemplateParameterValues {
  const values: TemplateParameterValues = {};
  for (const group of schema.groups) {
    if (group.nested) {
      const gv: Record<string, unknown> = {};
      for (const p of group.parameters) {
        if (p.defaultValue !== undefined) gv[p.id] = p.defaultValue;
      }
      values[group.id] = gv;
    } else {
      for (const p of group.parameters) {
        if (p.defaultValue !== undefined) values[p.id] = p.defaultValue;
      }
    }
  }
  return values;
}

// ── Lectura / escritura inmutable ───────────────────────────────────────

export function getParamValue(
  values: TemplateParameterValues,
  group: TemplateParameterGroup,
  paramId: string,
): unknown {
  if (group.nested) {
    const gv = values[group.id];
    return gv && typeof gv === 'object' ? (gv as Record<string, unknown>)[paramId] : undefined;
  }
  return values[paramId];
}

export function setParamValue(
  values: TemplateParameterValues,
  group: TemplateParameterGroup,
  paramId: string,
  value: unknown,
): TemplateParameterValues {
  if (group.nested) {
    const prev = values[group.id];
    const gv = { ...(prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : {}) };
    gv[paramId] = value;
    return { ...values, [group.id]: gv };
  }
  return { ...values, [paramId]: value };
}

// ── Visibilidad condicional ─────────────────────────────────────────────

/**
 * ¿Debe mostrarse el parámetro dado el estado del grupo?
 * - WAN: 'gateway' solo en modo estática; 'username'/'password' solo en PPPoE.
 * - Resto: siempre visible.
 */
export function isParameterVisible(
  group: TemplateParameterGroup,
  param: TemplateParameter,
  groupValues: Record<string, unknown>,
): boolean {
  if (/^wan\d+$/.test(group.id)) {
    const mode = String(groupValues.mode ?? 'dhcp');
    if (param.id === 'gateway') return mode === 'static';
    if (param.id === 'username' || param.id === 'password') return mode === 'pppoe';
  }
  return true;
}

/** Devuelve los valores del grupo (objeto nested o el raíz para 'global'). */
export function groupValuesOf(
  values: TemplateParameterValues,
  group: TemplateParameterGroup,
): Record<string, unknown> {
  if (group.nested) {
    const gv = values[group.id];
    return gv && typeof gv === 'object' ? (gv as Record<string, unknown>) : {};
  }
  return values;
}

// ── Resumen ─────────────────────────────────────────────────────────────

/** Cuenta cuántos parámetros tienen un valor presente (para el resumen). */
export function countConfiguredParameters(
  schema: TemplateParameterSchema,
  values: TemplateParameterValues,
): number {
  let n = 0;
  for (const group of schema.groups) {
    const gv = groupValuesOf(values, group);
    for (const p of group.parameters) {
      const raw = gv[p.id];
      if (raw !== undefined && raw !== null && raw !== '') n++;
    }
  }
  return n;
}
