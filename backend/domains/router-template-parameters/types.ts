// ====================================================================
// Dynamic Template Parameters Engine (Fase 4.9.2) — Tipos.
//
// Cada plantilla RouterOS declara su esquema de parámetros: qué puede
// personalizar el usuario desde el Wizard, con qué tipo, validación,
// default y compatibilidad. El Wizard renderiza el formulario a partir
// de este esquema (sin hardcodear campos) y el generador consume los
// valores resultantes.
// ====================================================================

export type TemplateParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'ip'
  | 'cidr';

export interface TemplateParameterOption {
  label: string;
  value: string;
}

export interface TemplateParameter {
  /** Identificador único dentro de su grupo (ej. 'lanCidr', 'mode'). */
  id: string;
  /** Etiqueta legible para la UI. */
  label: string;
  type: TemplateParameterType;
  required: boolean;
  defaultValue?: string | number | boolean;
  /** Opciones para type='select'. */
  options?: TemplateParameterOption[];
  description?: string;
  /**
   * NugaCore: el valor es sensible (ej. password PPPoE). Se redacta en
   * logs, auditoría, scriptPreview y en la vista del enrollment.
   * NUNCA se expone en claro; se persiste solo para regeneración.
   */
  secret?: boolean;
}

/**
 * Grupo de parámetros. 'global' es plano (las claves viven al nivel
 * superior de los values). Los grupos con nested=true viven anidados
 * bajo values[group.id] (ej. wan1, wan2…).
 */
export interface TemplateParameterGroup {
  id: string;
  label: string;
  nested: boolean;
  parameters: TemplateParameter[];
}

export interface TemplateParameterSchema {
  templateId: string;
  /** Nombre legible de la plantilla (espejo de la biblioteca). */
  templateName: string;
  groups: TemplateParameterGroup[];
}

/**
 * Valores enviados por el Wizard. Las claves del grupo 'global' viven
 * al nivel superior; los grupos anidados (wanN) viven bajo su id.
 *
 * Ej: { pbrEnabled: true, lanCidr: '192.168.100.1/24',
 *       wan1: { mode: 'dhcp', interface: 'ether1' },
 *       wan2: { mode: 'pppoe', interface: 'ether2', username: 'x', password: '***' } }
 */
export type TemplateParameterValues = Record<string, unknown>;

export interface ParameterValidationResult {
  valid: boolean;
  errors: string[];
}
