// ====================================================================
// Validadores e inspecciones de seguridad para la Biblioteca de
// Plantillas RouterOS (Fase 4.6.3).
// ====================================================================

import { TemplateLibraryId, TemplateLibraryParams, TEMPLATE_LIBRARY_IDS } from './types';

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME_RE = /^[a-zA-Z0-9._-]{1,253}$/;

const isValidCidr = (v: string): boolean => CIDR_RE.test(v);
const isValidIp = (v: string): boolean => IP_RE.test(v);
const isValidHostname = (v: string): boolean => HOSTNAME_RE.test(v);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const PCC_TEMPLATES = new Set<TemplateLibraryId>(['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan']);
const WG_TEMPLATES = new Set<TemplateLibraryId>(['router_base_wireguard', 'wireguard_client', 'tower_wisp']);

const wanCountOf = (id: TemplateLibraryId): number => {
  if (id === 'pcc_2wan') return 2;
  if (id === 'pcc_3wan') return 3;
  if (id === 'pcc_4wan') return 4;
  if (id === 'pcc_5wan') return 5;
  return 0;
};

export function validateTemplateParams(params: Partial<TemplateLibraryParams>): ValidationResult {
  const errors: string[] = [];

  if (!params.templateId || !(TEMPLATE_LIBRARY_IDS as string[]).includes(params.templateId)) {
    errors.push('templateId inválido o no reconocido');
  }
  if (!params.routerName || typeof params.routerName !== 'string' || params.routerName.trim().length === 0) {
    errors.push('routerName es requerido');
  } else if (params.routerName.length > 64) {
    errors.push('routerName no puede superar 64 caracteres');
  }
  if (!params.routerosVersion || !['6', '7'].includes(params.routerosVersion)) {
    errors.push('routerosVersion debe ser "6" o "7"');
  }

  if (errors.length > 0) return { valid: false, errors };

  const id = params.templateId as TemplateLibraryId;

  // WireGuard templates (router_base_wireguard, wireguard_client, tower_wisp).
  // Los campos WG pueden faltar: el generador produce placeholders explícitos
  // y warnings para que el técnico complete el .rsc sin provocar 400 en la UI.
  if (WG_TEMPLATES.has(id)) {
    if (params.wgRouterIp && !isValidCidr(params.wgRouterIp)) {
      errors.push('wgRouterIp debe ser un CIDR válido (ej: 10.0.0.2/24)');
    }
  }


  // WireGuard server
  if (id === 'wireguard_server') {
    if (params.wgRouterIp && !isValidCidr(params.wgRouterIp)) {
      errors.push('wgRouterIp debe ser un CIDR válido para el servidor WireGuard');
    }
  }

  // SSTP también permite placeholders explícitos cuando falta el host, igual que
  // el generador. Si el usuario provee host, sí validamos el formato.
  if (id === 'router_base_sstp') {
    if (params.sstpHost && !isValidHostname(params.sstpHost) && !isValidIp(params.sstpHost)) {
      errors.push('sstpHost debe ser un hostname o IP válidos');
    }
  }

  // PCC balancer
  if (PCC_TEMPLATES.has(id)) {
    const count = wanCountOf(id);
    if (!params.wanInterfaces || params.wanInterfaces.length < count) {
      errors.push(`wanInterfaces requiere al menos ${count} entradas para ${id}`);
    }
    if (!params.wanGateways || params.wanGateways.length < count) {
      errors.push(`wanGateways requiere al menos ${count} entradas para ${id}`);
    }
    if (params.wanGateways) {
      params.wanGateways.forEach((gw, i) => {
        if (!isValidIp(gw)) errors.push(`wanGateways[${i}] debe ser una IP válida: "${gw}"`);
      });
    }
  }

  // LAN optional params
  if (params.lanCidr && !isValidCidr(params.lanCidr)) {
    errors.push('lanCidr debe ser un CIDR válido (ej: 192.168.1.0/24)');
  }
  if (params.lanGateway && !isValidIp(params.lanGateway)) {
    errors.push('lanGateway debe ser una IP válida (ej: 192.168.1.1)');
  }
  if (params.dhcpPoolStart && !isValidIp(params.dhcpPoolStart)) {
    errors.push('dhcpPoolStart debe ser una IP válida');
  }
  if (params.dhcpPoolEnd && !isValidIp(params.dhcpPoolEnd)) {
    errors.push('dhcpPoolEnd debe ser una IP válida');
  }
  if (params.apiCidr && !isValidCidr(params.apiCidr)) {
    errors.push('apiCidr debe ser un CIDR válido');
  }
  if (params.nocApiCidr && !isValidCidr(params.nocApiCidr)) {
    errors.push('nocApiCidr debe ser un CIDR válido');
  }
  if (params.apiPort !== undefined && (params.apiPort < 1 || params.apiPort > 65535)) {
    errors.push('apiPort debe estar entre 1 y 65535');
  }

  return { valid: errors.length === 0, errors };
}

// ── Inspecciones de seguridad del script generado ────────────────────

const BRAND_VIOLATIONS = ['livaur', 'wisphub', 'uisp', '@livaur', 'livaur.com', 'sgcm', 'whmcs'];

export function assertNoBrandViolation(script: string): void {
  const lower = script.toLowerCase();
  for (const v of BRAND_VIOLATIONS) {
    if (lower.includes(v)) {
      throw new Error(`template-generator: branding externo prohibido detectado: "${v}"`);
    }
  }
}

const FORBIDDEN_POLICIES = ['sniff', 'sensitive', 'romon'];
const FORBIDDEN_KEYWORDS = ['ftp', 'reboot'];

export function assertNoForbiddenPolicies(script: string): void {
  const policyBlocks = script.match(/policy="([^"]+)"/gi) || [];
  for (const block of policyBlocks) {
    const policies = block
      .replace(/policy="/gi, '')
      .replace(/"$/, '')
      .split(',')
      .map((s) => s.trim().toLowerCase());
    for (const forbidden of FORBIDDEN_POLICIES) {
      if (policies.includes(forbidden)) {
        throw new Error(`template-generator: política prohibida "${forbidden}" detectada en policy block`);
      }
    }
  }
}

export function assertNoForbiddenKeywords(script: string): void {
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(script)) {
      throw new Error(`template-generator: keyword prohibido "${kw}" detectado en el script`);
    }
  }
}

/** Genera versión saneada del script: reemplaza secretos con placeholders. */
export function sanitizeForPreview(script: string): string {
  let s = script;
  s = s.replace(/(password=")[^"]+(")/gi, '$1••••••••$2');
  s = s.replace(/(private-key=")[^"]+(")/gi, '$1<PRIVATE_KEY_OMITIDA>$2');
  s = s.replace(/(preshared-key=")[^"]+(")/gi, '$1<PSK_OMITIDA>$2');
  s = s.replace(/(password=[^\s"\\]+)/gi, 'password=••••••••');
  return s;
}

/** Nombre de archivo seguro para el .rsc. */
export function buildTemplateFilename(routerName: string, templateId: string): string {
  const safe = routerName.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 32);
  const date = new Date().toISOString().slice(0, 10);
  return `nugacore-tpl-${templateId.replace(/_/g, '-')}-${safe}-${date}.rsc`;
}
