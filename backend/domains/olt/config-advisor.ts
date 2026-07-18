// ====================================================================
// Advisor de configuración inicial de OLT.
//
// Base de conocimiento por marca/modelo (las OLT más comunes en WISP LATAM) y
// recomendación de configuración inicial priorizando RENDIMIENTO y ESTABILIDAD.
//
// No ejecuta nada: solo sugiere parámetros y justificación. El script real lo
// arma script-generator.ts a partir de esta recomendación.
// ====================================================================

import type {
  OltCatalogEntry,
  OltCliFlavor,
  OltConfigRecommendation,
  OltConfigSetting,
  PonType,
} from './types';

interface ModelSpec {
  ponPorts: number;
  defaultPonType: PonType;
}

interface BrandSpec {
  cliFlavor: OltCliFlavor;
  models: Record<string, ModelSpec>;
}

// Catálogo curado. Puertos PON son los típicos del chasis/modelo base.
const CATALOG: Record<string, BrandSpec> = {
  Huawei: {
    cliFlavor: 'huawei',
    models: {
      'MA5608T': { ponPorts: 8, defaultPonType: 'gpon' },
      'MA5680T': { ponPorts: 16, defaultPonType: 'gpon' },
      'MA5800-X2': { ponPorts: 8, defaultPonType: 'gpon' },
      'MA5800-X7': { ponPorts: 16, defaultPonType: 'gpon' },
    },
  },
  ZTE: {
    cliFlavor: 'zte',
    models: {
      'C320': { ponPorts: 8, defaultPonType: 'gpon' },
      'C300': { ponPorts: 16, defaultPonType: 'gpon' },
      'C610': { ponPorts: 8, defaultPonType: 'gpon' },
    },
  },
  VSOL: {
    cliFlavor: 'vsol-bdcom',
    models: {
      'V1600D': { ponPorts: 4, defaultPonType: 'gpon' },
      'V1600G': { ponPorts: 8, defaultPonType: 'gpon' },
    },
  },
  BDCOM: {
    cliFlavor: 'vsol-bdcom',
    models: {
      'P3310C': { ponPorts: 4, defaultPonType: 'epon' },
      'P3608': { ponPorts: 8, defaultPonType: 'gpon' },
    },
  },
  'C-Data': {
    cliFlavor: 'cdata',
    models: {
      'FD1616S': { ponPorts: 16, defaultPonType: 'gpon' },
      'FD1104': { ponPorts: 4, defaultPonType: 'gpon' },
    },
  },
  Fiberhome: {
    cliFlavor: 'fiberhome',
    models: {
      'AN5516-01': { ponPorts: 16, defaultPonType: 'gpon' },
    },
  },
};

export const listCatalog = (): OltCatalogEntry[] =>
  Object.entries(CATALOG).map(([brand, spec]) => ({
    brand,
    models: Object.keys(spec.models),
    cliFlavor: spec.cliFlavor,
    defaultPonType: Object.values(spec.models)[0]?.defaultPonType ?? 'gpon',
  }));

export const isKnownModel = (brand: string, model: string): boolean =>
  Boolean(CATALOG[brand]?.models[model]);

// Ajustes comunes de estabilidad/rendimiento (válidos para GPON en general).
const commonSettings = (mgmtVlan: number): OltConfigSetting[] => [
  {
    key: 'management_vlan',
    value: String(mgmtVlan),
    reason:
      'VLAN de gestión separada del tráfico de servicio: evita que un problema ' +
      'de broadcast/servicio deje sin acceso a la OLT (estabilidad de gestión).',
  },
  {
    key: 'ssh_only',
    value: 'enabled (telnet disabled)',
    reason: 'Solo SSH: gestión cifrada y menos superficie de ataque.',
  },
  {
    key: 'onu_auth_mode',
    value: 'by-serial-number',
    reason:
      'Autenticación de ONU por número de serie: evita auto-registro no ' +
      'controlado y da un mapeo estable ONU↔cliente.',
  },
  {
    key: 'dba_profile',
    value: 'assured+max (SR-DBA type 3)',
    reason:
      'DBA con ancho garantizado + máximo: reparte upstream de forma justa y ' +
      'estable bajo carga, sin colapsar en horas pico.',
  },
  {
    key: 'uplink_storm_control',
    value: 'broadcast/multicast rate-limit ON',
    reason:
      'Control de tormentas en el uplink: una tormenta de broadcast no tumba el ' +
      'segmento (estabilidad).',
  },
  {
    key: 'ntp',
    value: 'enabled',
    reason: 'Reloj sincronizado: logs correlacionables y perfiles horarios fiables.',
  },
  {
    key: 'syslog',
    value: 'remote (NOC)',
    reason: 'Syslog al NOC: visibilidad temprana de fallas de PON/uplink.',
  },
];

// Split recomendado por estabilidad: 1:64 deja margen óptico y de DBA frente a
// 1:128 (soportado, pero con menos margen para crecer/degradación de fibra).
const RECOMMENDED_SPLIT = '1:64';
const ONUS_PER_PON_RECOMMENDED = 64;

export interface SuggestConfigInput {
  brand: string;
  model: string;
  ponType?: PonType;
  managementVlan?: number;
}

/**
 * Sugiere configuración inicial para una marca/modelo. Si el modelo no está en
 * el catálogo, devuelve una recomendación GPON genérica (cliFlavor 'generic')
 * con las mismas buenas prácticas — marcada como tal en el summary.
 */
export const suggestConfig = (input: SuggestConfigInput): OltConfigRecommendation => {
  const brandSpec = CATALOG[input.brand];
  const modelSpec = brandSpec?.models[input.model];
  const cliFlavor: OltCliFlavor = brandSpec?.cliFlavor ?? 'generic';
  const ponPorts = modelSpec?.ponPorts ?? 8;
  const ponType = input.ponType ?? modelSpec?.defaultPonType ?? 'gpon';
  const mgmtVlan = input.managementVlan ?? 100;

  const known = Boolean(modelSpec);
  const summary = known
    ? `Configuración inicial recomendada para ${input.brand} ${input.model} (${ponType.toUpperCase()}), optimizada para estabilidad.`
    : `Modelo no catalogado: recomendación GPON genérica de buenas prácticas para ${input.brand} ${input.model}. Revisar contra el manual del equipo.`;

  const rationale = [
    `Split ${RECOMMENDED_SPLIT} por puerto PON: prioriza margen óptico y de DBA sobre densidad máxima.`,
    `Hasta ~${ONUS_PER_PON_RECOMMENDED} ONUs activas por PON para mantener latencia estable en hora pico.`,
    'Gestión aislada en VLAN dedicada y solo por SSH.',
    'ONU autenticada por serie: inventario estable y sin altas fantasma.',
    'Control de tormentas + syslog remoto: fallas visibles antes de que escalen.',
  ];
  if (!known) {
    rationale.push('⚠ Modelo fuera de catálogo: validar sintaxis exacta con la documentación del fabricante.');
  }

  return {
    brand: input.brand,
    model: input.model,
    ponType,
    cliFlavor,
    summary,
    rationale,
    settings: commonSettings(mgmtVlan),
    capacity: {
      ponPorts,
      onusPerPonRecommended: ONUS_PER_PON_RECOMMENDED,
      recommendedSplit: RECOMMENDED_SPLIT,
    },
  };
};
