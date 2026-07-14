// ====================================================================
// Dynamic Template Parameters Engine (Fase 4.9.2) — Mappers.
//
// Traduce los valores dinámicos del Wizard al shape TemplateLibraryParams
// que consume el generador existente (Fase 4.6.3). NO modifica el
// generador ni la biblioteca: solo puebla los parámetros que el generador
// ya sabe consumir. Los parámetros que el generador aún no consume
// (pbrEnabled, dhcpEnabled, bandwidthMbps, pingTarget, alertas NOC,
// credenciales PPPoE por WAN) se persisten en templateParameters para
// compatibilidad futura, sin afectar la generación actual.
// ====================================================================

import type { TemplateLibraryParams } from '../routeros-templates/types';
import type { TemplateParameterValues } from './types';

// ── Utilidades IPv4 ─────────────────────────────────────────────────────

const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, oct) => ((acc << 8) + (Number(oct) & 255)) >>> 0, 0) >>> 0;

const intToIp = (n: number): string =>
  [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

const ipPart = (cidr: string): string => cidr.split('/')[0];

/** Convierte "192.168.88.1/24" en la dirección de red "192.168.88.0/24". */
const networkCidr = (cidr: string): string => {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr ?? '24');
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || prefix < 0 || prefix > 32) return cidr;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (ipToInt(ip) & mask) >>> 0;
  return `${intToIp(net)}/${prefix}`;
};

const PCC_COUNT: Record<string, number> = { pcc_2wan: 2, pcc_3wan: 3, pcc_4wan: 4, pcc_5wan: 5 };

const asString = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);

/**
 * Traduce los valores dinámicos al subconjunto de TemplateLibraryParams
 * que el generador consume. Solo incluye claves presentes (no clobbea con
 * undefined los valores resueltos por el template-mapper de Fase 4.9.1).
 */
export function mapParametersToLibraryParams(
  templateId: string,
  values: TemplateParameterValues | undefined | null,
): Partial<TemplateLibraryParams> {
  const v = values ?? {};
  const out: Partial<TemplateLibraryParams> = {};

  // ── Global LAN ──────────────────────────────────────────────────────
  const lanCidr = asString(v.lanCidr);
  let lanPrefix3: string | undefined;
  if (lanCidr) {
    out.lanGateway = ipPart(lanCidr);
    out.lanCidr = networkCidr(lanCidr);
    lanPrefix3 = out.lanGateway.split('.').slice(0, 3).join('.');
  }
  const dnsServers = asString(v.dnsServers);
  if (dnsServers) {
    const list = dnsServers.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) out.dnsServers = list;
  }
  if (typeof v.dhcpEnabled === 'boolean') out.enableDhcp = v.dhcpEnabled;

  // WAN / LAN genéricos (cualquier plantilla core que los declare)
  const wan = asString(v.wanInterface)?.replace(/\behter(\d+)\b/gi, 'ether$1');
  if (wan) out.wanInterface = wan;
  const bridge = asString(v.lanBridgeName);
  if (bridge) out.lanBridgeName = bridge;
  const lanIf = asString(v.lanInterfaces);
  if (lanIf) {
    out.lanInterfaces = lanIf
      .split(',')
      .map((s) => s.trim().replace(/\behter(\d+)\b/gi, 'ether$1'))
      .filter(Boolean);
  }
  const poolStart = asString(v.dhcpPoolStart);
  const poolEnd = asString(v.dhcpPoolEnd);
  // Si el pool no coincide con el prefijo LAN (defaults viejos 192.168.88 / 192.168.1),
  // realinear a .10–.254 de la LAN elegida.
  if (poolStart && lanPrefix3) {
    const ps = poolStart.split('.').slice(0, 3).join('.');
    out.dhcpPoolStart = ps === lanPrefix3 ? poolStart : `${lanPrefix3}.10`;
  } else if (poolStart) {
    out.dhcpPoolStart = poolStart;
  }
  if (poolEnd && lanPrefix3) {
    const pe = poolEnd.split('.').slice(0, 3).join('.');
    out.dhcpPoolEnd = pe === lanPrefix3 ? poolEnd : `${lanPrefix3}.254`;
  } else if (poolEnd) {
    out.dhcpPoolEnd = poolEnd;
  }

  // ── PCC: WANs → wanInterfaces / wanGateways ────────────────────────
  const pccCount = PCC_COUNT[templateId];
  if (pccCount) {
    const ifaces: string[] = [];
    const gws: string[] = [];
    for (let i = 1; i <= pccCount; i++) {
      const w = v[`wan${i}`] as Record<string, unknown> | undefined;
      const iface = asString(w?.interface);
      const gw = asString(w?.gateway);
      if (iface) ifaces.push(iface);
      if (gw) gws.push(gw);
    }
    if (ifaces.length) out.wanInterfaces = ifaces;
    if (gws.length) out.wanGateways = gws;
  }

  // ── PPPoE Server ────────────────────────────────────────────────────
  if (templateId === 'pppoe_server') {
    const pppoeInterface = asString(v.pppoeInterface);
    const poolStart = asString(v.poolStart);
    const poolEnd = asString(v.poolEnd);
    const localAddress = asString(v.localAddress);
    if (pppoeInterface) out.pppoeInterface = pppoeInterface;
    if (poolStart) out.pppoeRemotePoolStart = poolStart;
    if (poolEnd) out.pppoeRemotePoolEnd = poolEnd;
    if (localAddress) out.pppoeLocalIp = localAddress;
  }

  // ── Tower WISP ──────────────────────────────────────────────────────
  if (templateId === 'tower_wisp') {
    if (v.vlanManagement !== undefined && v.vlanManagement !== '') {
      out.vlanManagement = Number(v.vlanManagement);
    }
    if (v.vlanClients !== undefined && v.vlanClients !== '') {
      out.vlanClients = Number(v.vlanClients);
    }
  }

  // ── Monitoring agent ────────────────────────────────────────────────
  if (templateId === 'monitoring_agent') {
    const watchdogTarget = asString(v.watchdogTarget);
    if (watchdogTarget) out.watchdogTarget = watchdogTarget;
    if (typeof v.enableAutoBackup === 'boolean') out.enableAutoBackup = v.enableAutoBackup;
  }

  // ── Factory onboarding (WISP) ─────────────────────────────────────────
  if (templateId === 'nugacore_factory_onboarding') {
    const zoneName = asString(v.zoneName);
    if (zoneName) out.zoneName = zoneName;
    if (v.apiPort !== undefined && v.apiPort !== '') {
      const port = Number(v.apiPort);
      if (Number.isFinite(port)) out.apiPort = port;
    }
  }

  return out;
}
