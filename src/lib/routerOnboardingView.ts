// ====================================================================
// Helpers puros del Router Onboarding Wizard (Fase 4.9).
// Sin dependencias React — testeable sin jsdom.
// ====================================================================

// ── Tipos ─────────────────────────────────────────────────────────────

export type RouterType = 'core' | 'tower' | 'distribution' | 'client_router' | 'lab';
export type RouterModel = 'RB5009' | 'CCR' | 'CHR' | 'hEX' | 'hAP' | 'Otro';

export interface OnboardingTemplate {
  id: string;
  label: string;
  description: string;
  routerosVersion: '6' | '7' | 'any';
}

export interface OnboardingForm {
  // Paso 1 — Datos del router
  routerName: string;
  routerType: RouterType;
  routerosVersion: '6' | '7';
  model: RouterModel;
  siteName: string;
  notes: string;
  // Paso 3 — Plantilla inicial
  templateId: string;
  // Paso 4 — Configuración LAN
  lanCidr: string;
  lanGateway: string;
  lanBridgeName: string;
  dhcpStart: string;
  dhcpEnd: string;
  wanInterface: string;
  lanInterfaces: string;
}

// ── Constantes ─────────────────────────────────────────────────────────

export const ROUTER_TYPE_OPTIONS: Array<{ value: RouterType; label: string }> = [
  { value: 'core',          label: 'Core / Concentrador' },
  { value: 'tower',         label: 'Torre WISP' },
  { value: 'distribution',  label: 'Distribución' },
  { value: 'client_router', label: 'Router cliente' },
  { value: 'lab',           label: 'Laboratorio / CHR' },
];

export const MODEL_OPTIONS: Array<{ value: RouterModel; label: string }> = [
  { value: 'RB5009', label: 'RB5009' },
  { value: 'CCR',    label: 'CCR (Cloud Core Router)' },
  { value: 'CHR',    label: 'CHR (Cloud Hosted)' },
  { value: 'hEX',    label: 'hEX / hEX lite' },
  { value: 'hAP',    label: 'hAP / hAP ac' },
  { value: 'Otro',   label: 'Otro modelo' },
];

export const ONBOARDING_TEMPLATES: OnboardingTemplate[] = [
  {
    id: 'router_base_wireguard',
    label: 'Router Base + WireGuard',
    description: 'Bridge LAN, DHCP, NAT, firewall básico y túnel WireGuard NugaCore. Recomendado para producción.',
    routerosVersion: '7',
  },
  {
    id: 'tower_wisp',
    label: 'Torre WISP',
    description: 'RB5009 / CCR con VLANs, management VLAN, WireGuard y monitoreo completo.',
    routerosVersion: '7',
  },
  {
    id: 'pcc_2wan',
    label: 'Balanceador PCC — 2 WAN',
    description: 'Balanceo de carga PCC con 2 conexiones WAN y failover automático.',
    routerosVersion: 'any',
  },
  {
    id: 'pcc_3wan',
    label: 'Balanceador PCC — 3 WAN',
    description: 'Balanceo de carga PCC con 3 conexiones WAN y failover automático.',
    routerosVersion: 'any',
  },
  {
    id: 'pcc_4wan',
    label: 'Balanceador PCC — 4 WAN',
    description: 'Balanceo de carga PCC con 4 conexiones WAN y failover automático.',
    routerosVersion: 'any',
  },
  {
    id: 'pcc_5wan',
    label: 'Balanceador PCC — 5 WAN',
    description: 'Balanceo de carga PCC con 5 conexiones WAN y failover automático.',
    routerosVersion: 'any',
  },
  {
    id: 'pppoe_server',
    label: 'Servidor PPPoE',
    description: 'PPPoE Server completo con pools de IPs, perfiles de velocidad y queues simples.',
    routerosVersion: 'any',
  },
  {
    id: 'noc_ready',
    label: 'NOC Ready',
    description: 'API segura, usuario nugacore, logging estructurado, watchdog y auditoría.',
    routerosVersion: 'any',
  },
  {
    id: 'monitoring_agent',
    label: 'Lab / CHR',
    description: 'Scheduler, watchdog, backups automáticos y métricas del sistema. Ideal para laboratorio.',
    routerosVersion: 'any',
  },
];

export const DEFAULT_FORM: OnboardingForm = {
  routerName:      '',
  routerType:      'tower',
  routerosVersion: '7',
  model:           'RB5009',
  siteName:        '',
  notes:           '',
  templateId:      'router_base_wireguard',
  lanCidr:         '192.168.88.0/24',
  lanGateway:      '192.168.88.1',
  lanBridgeName:   'bridgeLAN',
  dhcpStart:       '192.168.88.10',
  dhcpEnd:         '192.168.88.254',
  wanInterface:    'ether1',
  lanInterfaces:   'ether2,ether3,ether4,ether5',
};

// ── Helpers puros ───────────────────────────────────────────────────────

/**
 * Etiqueta legible de la plantilla seleccionada.
 * Single source of truth: el resumen del wizard y cualquier UI deben usar esto
 * para reflejar exactamente la plantilla en form.templateId (evita divergencias
 * entre lo que se muestra y lo que se envía en el payload).
 */
export function getTemplateLabel(templateId: string): string {
  return ONBOARDING_TEMPLATES.find((t) => t.id === templateId)?.label ?? templateId;
}

/**
 * ¿Requiere el template RouterOS v7 pero el formulario tiene v6?
 * Devuelve el texto de advertencia o null si no hay problema.
 */
export function getTemplateV7Warning(
  templateId: string,
  routerosVersion: '6' | '7',
): string | null {
  const tpl = ONBOARDING_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl || tpl.routerosVersion !== '7' || routerosVersion === '7') return null;
  return `La plantilla "${tpl.label}" requiere RouterOS v7. Selecciona v7 o elige una plantilla compatible con v6.`;
}

/**
 * Construye el campo `notes` del payload codificando los metadatos de UI
 * que el backend ignora pero que son útiles para trazabilidad.
 */
export function buildNotesFromForm(form: OnboardingForm): string {
  const parts: string[] = [];
  parts.push(`[${form.routerType}]`);
  if (form.model !== 'Otro') parts.push(`Modelo: ${form.model}`);
  if (form.siteName.trim())  parts.push(`Sitio: ${form.siteName.trim()}`);
  parts.push(`Plantilla: ${form.templateId}`);
  if (form.notes.trim())     parts.push(form.notes.trim());
  return parts.join(' | ');
}

/**
 * Construye el payload para POST /api/router-enrollment/start.
 * wgServerId se omite para usar DEFAULT_WIREGUARD_SERVER.
 */
export function buildEnrollmentPayload(form: OnboardingForm): Record<string, unknown> {
  return {
    routerName:       form.routerName.trim(),
    routerosVersion:  form.routerosVersion,
    // Metadatos UI (backend los ignora; persisten en notes para trazabilidad)
    routerType:       form.routerType,
    templateId:       form.templateId,
    // LAN config
    lanCidr:          form.lanCidr.trim()       || undefined,
    lanGateway:       form.lanGateway.trim()    || undefined,
    lanBridgeName:    form.lanBridgeName.trim() || undefined,
    wanInterface:     form.wanInterface.trim()  || undefined,
    lanInterfaces:    form.lanInterfaces.trim() || undefined,
    notes:            buildNotesFromForm(form),
    // wgServerId omitido → usa DEFAULT_WIREGUARD_SERVER
  };
}

// ====================================================================
// Modo Avanzado — tipos y helpers (Fase 4.9.1)
// ====================================================================

// ── Tipos avanzados ────────────────────────────────────────────────────

export type WanConnectionType = 'dhcp' | 'static' | 'pppoe';
export type ConfigMode = 'basic' | 'advanced';

export interface WanConfig {
  interfaceName: string;
  newName: string;
  connectionType: WanConnectionType;
  staticIp: string;
  cidr: string;
  gateway: string;
  downloadMbps: string;
  pingHost: string;
  pingCount: string;
  routePriority: string;
  routingTable: string;
}

export interface LanAdvancedConfig {
  lanInterface: string;
  lanNewName: string;
  lanCidr: string;
  lanGateway: string;
  enableDhcp: boolean;
  dhcpStart: string;
  dhcpEnd: string;
  dnsServers: string;
}

export interface SecurityConfig {
  enableBasicFirewall: boolean;
  enableHotspotCompatibility: boolean;
  enableNotifications: boolean;
  enablePbr: boolean;
}

export interface AdvancedOnboardingForm extends OnboardingForm {
  configMode: ConfigMode;
  wanConfigs: WanConfig[];
  lanAdvanced: LanAdvancedConfig;
  security: SecurityConfig;
}

// ── Defaults avanzados ─────────────────────────────────────────────────

export const DEFAULT_WAN_CONFIG: WanConfig = {
  interfaceName: 'ether1',
  newName:        'WAN1',
  connectionType: 'dhcp',
  staticIp:       '',
  cidr:           '',
  gateway:        '',
  downloadMbps:   '100',
  pingHost:       '8.8.8.8',
  pingCount:      '3',
  routePriority:  '1',
  routingTable:   'wan1',
};

export const DEFAULT_LAN_ADVANCED: LanAdvancedConfig = {
  lanInterface: 'bridge-lan',
  lanNewName:   '',
  lanCidr:      '192.168.88.0/24',
  lanGateway:   '192.168.88.1',
  enableDhcp:   true,
  dhcpStart:    '192.168.88.10',
  dhcpEnd:      '192.168.88.254',
  dnsServers:   '8.8.8.8,8.8.4.4',
};

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enableBasicFirewall:       true,
  enableHotspotCompatibility: false,
  enableNotifications:       true,
  enablePbr:                 true,
};

export const DEFAULT_ADVANCED_FORM: AdvancedOnboardingForm = {
  ...DEFAULT_FORM,
  configMode:  'basic',
  wanConfigs:  [],
  lanAdvanced: { ...DEFAULT_LAN_ADVANCED },
  security:    { ...DEFAULT_SECURITY_CONFIG },
};

// ── Helpers avanzados ──────────────────────────────────────────────────

/** Plantillas PCC con configuración multi-WAN. */
const PCC_WAN_COUNT: Record<string, number> = {
  pcc_2wan: 2,
  pcc_3wan: 3,
  pcc_4wan: 4,
  pcc_5wan: 5,
};

/** ¿El templateId es una plantilla PCC (multi-WAN)? */
export function isPccTemplate(templateId: string): boolean {
  return templateId in PCC_WAN_COUNT;
}

/**
 * Cantidad de WANs configurables para el template.
 * Devuelve 0 para plantillas que no son PCC.
 */
export function getWanCountForTemplate(templateId: string): number {
  return PCC_WAN_COUNT[templateId] ?? 0;
}

/**
 * Construye N WanConfig con defaults ajustados por índice
 * (interfaceName ether1…etherN, newName WAN1…WANN, routingTable wan1…wanN).
 */
export function buildDefaultWanConfigs(count: number): WanConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    ...DEFAULT_WAN_CONFIG,
    interfaceName: `ether${i + 1}`,
    newName:       `WAN${i + 1}`,
    routePriority: String(i + 1),
    routingTable:  `wan${i + 1}`,
  }));
}

/**
 * Construye el payload para POST /api/router-enrollment/start en modo avanzado.
 * En modo básico delega a buildEnrollmentPayload.
 * Los campos extra (wanConfigs, lanAdvanced, security) son ignorados por el
 * backend actual pero persisten en el payload para compatibilidad futura.
 */
export function buildAdvancedEnrollmentPayload(
  form: AdvancedOnboardingForm,
): Record<string, unknown> {
  const isAdvanced = form.configMode === 'advanced';

  // En modo avanzado, los campos top-level de LAN vienen de lanAdvanced
  const effectiveLanCidr     = isAdvanced ? form.lanAdvanced.lanCidr     : form.lanCidr;
  const effectiveLanGateway  = isAdvanced ? form.lanAdvanced.lanGateway  : form.lanGateway;
  const effectiveLanBridge   = isAdvanced ? form.lanAdvanced.lanInterface : form.lanBridgeName;
  const effectiveWanIf       = isAdvanced && isPccTemplate(form.templateId)
    ? (form.wanConfigs[0]?.interfaceName || form.wanInterface)
    : form.wanInterface;

  const base = buildEnrollmentPayload({
    ...form,
    lanCidr:      effectiveLanCidr,
    lanGateway:   effectiveLanGateway,
    lanBridgeName: effectiveLanBridge,
    wanInterface:  effectiveWanIf,
  });

  if (!isAdvanced) {
    return { ...base, configMode: 'basic' };
  }

  return {
    ...base,
    configMode: 'advanced',
    ...(isPccTemplate(form.templateId) && { wanConfigs: form.wanConfigs }),
    lanAdvanced: form.lanAdvanced,
    security:    form.security,
  };
}
