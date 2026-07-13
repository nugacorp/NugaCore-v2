// ====================================================================
// Generador de la Biblioteca de Plantillas RouterOS (Fase 4.6.3).
//
// 13 plantillas en 8 categorías. Cada plantilla produce un script .rsc
// completo, seguro e idempotente. Nunca contiene branding externo ni
// políticas prohibidas (sniff / sensitive / romon / ftp / reboot).
//
// Prefijo NugaCore / nugacore en todos los objetos creados.
// Permisos API mínimos: read,write,api,test
// ====================================================================

import { createHash } from 'crypto';
import { generateApiCredential } from '../mikrotik/provisioning/credentials';
import { generateSnmpCommunity } from '../mikrotik/provisioning/snmp-credentials';
import { NUGACORE_GROUP_POLICY } from '../mikrotik/provisioning/script-generator';
import {
  TemplateLibraryParams,
  TemplateGeneratedResource,
  TEMPLATE_LIBRARY_VERSION,
} from './types';
import {
  buildTemplateFilename,
  assertNoBrandViolation,
  assertNoForbiddenPolicies,
  assertNoForbiddenKeywords,
} from './validators';

const sha256Short = (v: string): string =>
  createHash('sha256').update(v).digest('hex').substring(0, 32);

// ── Valores por defecto ────────────────────────────────────────────

interface Defaults {
  bridge: string;
  lanCidr: string;
  lanGw: string;
  wan: string;
  lanPorts: string[];
  poolStart: string;
  poolEnd: string;
  dns: string[];
  apiPort: number;
  apiCidr: string;
}

const getDefaults = (p: TemplateLibraryParams): Defaults => ({
  bridge: p.lanBridgeName || 'bridge-lan',
  lanCidr: p.lanCidr || '192.168.1.0/24',
  lanGw: p.lanGateway || '192.168.1.1',
  wan: p.wanInterface || 'ether1',
  lanPorts: p.lanInterfaces?.length ? p.lanInterfaces : ['ether2', 'ether3', 'ether4', 'ether5'],
  poolStart: p.dhcpPoolStart || '192.168.1.10',
  poolEnd: p.dhcpPoolEnd || '192.168.1.254',
  dns: p.dnsServers?.length ? p.dnsServers : ['8.8.8.8', '1.1.1.1'],
  apiPort: p.apiPort ?? 8728,
  apiCidr: p.apiCidr || '10.0.0.0/24',
  enableDhcp: p.enableDhcp !== false,
});

// ── Cabecera estándar ──────────────────────────────────────────────

const header = (p: TemplateLibraryParams, name: string): string => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `# NugaCore
# ============================================================
# NugaCore — Templates Library Script
# Plantilla : ${name}
# Router    : ${p.routerName}
# Generado  : ${ts} UTC
# Version   : ${TEMPLATE_LIBRARY_VERSION}
# RouterOS  : v${p.routerosVersion}+
# ============================================================
# ADVERTENCIA: Realiza un backup antes de importar.
#   /system backup save name=pre-nugacore-tpl
# Importar:
#   /import file-name=<archivo.rsc>
# ============================================================`;
};

// ── Secciones comunes ─────────────────────────────────────────────

const sectionIdentity = (name: string): string => `
# --- Identidad ---
/system identity set name="${name}"`;

const sectionBridge = (d: Defaults): string => {
  const ports = d.lanPorts
    .map(
      (p) => `:if ([:len [/interface bridge port find interface="${p}" bridge="${d.bridge}"]] = 0) do={
  /interface bridge port add interface="${p}" bridge="${d.bridge}" comment="NugaCore"
}`,
    )
    .join('\n');
  return `
# --- Bridge LAN ---
:if ([:len [/interface bridge find name="${d.bridge}"]] = 0) do={
  /interface bridge add name="${d.bridge}" fast-forward=no comment="NugaCore LAN bridge"
}
${ports}`;
};

const sectionInterfaceLists = (d: Defaults): string => `
# --- Interface Lists ---
:if ([:len [/interface list find name=WAN]] = 0) do={ /interface list add name=WAN }
:if ([:len [/interface list find name=LAN]] = 0) do={ /interface list add name=LAN }
:if ([:len [/interface list member find interface="${d.wan}" list=WAN]] = 0) do={
  /interface list member add interface="${d.wan}" list=WAN comment="NugaCore WAN"
}
:if ([:len [/interface list member find interface="${d.bridge}" list=LAN]] = 0) do={
  /interface list member add interface="${d.bridge}" list=LAN comment="NugaCore LAN"
}`;

const sectionLanIp = (d: Defaults): string => {
  const prefix = d.lanCidr.split('/')[1] || '24';
  return `
# --- IP LAN ---
:if ([:len [/ip address find address="${d.lanGw}/${prefix}" interface="${d.bridge}"]] = 0) do={
  /ip address add address="${d.lanGw}/${prefix}" interface="${d.bridge}" comment="NugaCore LAN"
}`;
};

const sectionDhcp = (d: Defaults): string => {
  return `
# --- DHCP Pool ---
:if ([:len [/ip pool find name="NugaCore-pool-LAN"]] = 0) do={
  /ip pool add name="NugaCore-pool-LAN" ranges="${d.poolStart}-${d.poolEnd}"
}
# --- DHCP Server ---
:if ([:len [/ip dhcp-server find name="NugaCore-dhcp-LAN"]] = 0) do={
  /ip dhcp-server add name="NugaCore-dhcp-LAN" interface="${d.bridge}" address-pool="NugaCore-pool-LAN" disabled=no
}
:if ([:len [/ip dhcp-server network find address="${d.lanCidr}"]] = 0) do={
  /ip dhcp-server network add address="${d.lanCidr}" gateway="${d.lanGw}" dns-server="${d.dns.join(',')}" comment="NugaCore"
}
/ip dns set allow-remote-requests=yes servers="${d.dns.join(',')}"`;
};

const sectionNat = (_d: Defaults): string => `
# --- NAT masquerade ---
:if ([:len [/ip firewall nat find action=masquerade chain=srcnat comment~"NugaCore"]] = 0) do={
  /ip firewall nat add action=masquerade chain=srcnat out-interface-list=WAN comment="NugaCore NAT"
}`;

const sectionFirewall = (): string => `
# --- Firewall básico ---
:if ([:len [/ip firewall filter find chain=input action=accept connection-state=established,related comment~"NugaCore"]] = 0) do={
  /ip firewall filter add chain=input action=accept connection-state=established,related comment="NugaCore established"
}
:if ([:len [/ip firewall filter find chain=input action=accept in-interface-list=LAN comment~"NugaCore"]] = 0) do={
  /ip firewall filter add chain=input action=accept in-interface-list=LAN comment="NugaCore allow LAN"
}
:if ([:len [/ip firewall filter find chain=input action=drop in-interface-list=WAN comment~"NugaCore"]] = 0) do={
  /ip firewall filter add chain=input action=drop in-interface-list=WAN comment="NugaCore drop WAN"
}`;

const sectionApiUser = (user: string, pass: string, apiCidr: string, apiPort: number): string => `
# --- Grupo y usuario API NugaCore (permisos mínimos) ---
:if ([:len [/user group find name="nugacore"]] = 0) do={
  /user group add name="nugacore" policy="${NUGACORE_GROUP_POLICY}" comment="NugaCore minimal API group"
}
/user add name="${user}" password="${pass}" group="nugacore" comment="NugaCore API user"
# --- API Service (solo desde red de gestión) ---
/ip service set api port=${apiPort} address="${apiCidr}" disabled=no
/ip service disable telnet`;

const sectionSystemNote = (routerName: string, templateName: string): string => `
# --- System note ---
/system note set note="NugaCore Templates Library\\n${routerName}\\n${templateName}\\n${new Date().toISOString().slice(0, 10)}"`;

const sectionFileCleanup = (): string => `
# --- Limpieza del archivo tras importar ---
:delay 2
/file remove [find name~"nugacore-tpl-"]
:log info "NugaCore Templates: script aplicado correctamente."`;

// ── Sección SNMP (factory onboarding) ───────────────────────────────

const sectionSnmp = (community: string, mgmtCidr: string, zoneName: string): string => `
# --- SNMP NugaCore (solo lectura, red de gestión) ---
/snmp set enabled=yes contact="NugaCore" location="${zoneName.replace(/"/g, '')}"
:if ([:len [/snmp community find name="${community}"]] = 0) do={
  /snmp community add name="${community}" addresses="${mgmtCidr}" read-access=yes write-access=no comment="NugaCore SNMP"
} else={
  /snmp community set [find name="${community}"] addresses="${mgmtCidr}" read-access=yes write-access=no
}`;

// ── Firewall gestión (API + SNMP solo desde VPN) ────────────────────

const sectionFactoryFirewall = (vpnCidr: string, apiPort: number): string => `
# --- Firewall gestión NugaCore (API + SNMP solo VPN) ---
:if ([:len [/ip firewall filter find chain=input protocol=udp dst-port=13231 comment~"NugaCore WG inbound"]] = 0) do={
  /ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="NugaCore WG inbound"
}
:if ([:len [/ip firewall filter find chain=input protocol=tcp dst-port=${apiPort} src-address="${vpnCidr}" comment~"NugaCore API VPN"]] = 0) do={
  /ip firewall filter add chain=input protocol=tcp dst-port=${apiPort} src-address="${vpnCidr}" action=accept comment="NugaCore API VPN"
}
:if ([:len [/ip firewall filter find chain=input protocol=tcp dst-port=8729 src-address="${vpnCidr}" comment~"NugaCore API-SSL VPN"]] = 0) do={
  /ip firewall filter add chain=input protocol=tcp dst-port=8729 src-address="${vpnCidr}" action=accept comment="NugaCore API-SSL VPN"
}
:if ([:len [/ip firewall filter find chain=input protocol=udp dst-port=161 src-address="${vpnCidr}" comment~"NugaCore SNMP VPN"]] = 0) do={
  /ip firewall filter add chain=input protocol=udp dst-port=161 src-address="${vpnCidr}" action=accept comment="NugaCore SNMP VPN"
}
:if ([:len [/ip firewall filter find chain=input protocol=tcp dst-port=${apiPort} action=drop comment~"NugaCore API deny"]] = 0) do={
  /ip firewall filter add chain=input protocol=tcp dst-port=${apiPort} action=drop log=yes log-prefix="NugaCore-API-deny:" comment="NugaCore API deny external"
}
:if ([:len [/ip firewall filter find chain=input protocol=udp dst-port=161 action=drop comment~"NugaCore SNMP deny"]] = 0) do={
  /ip firewall filter add chain=input protocol=udp dst-port=161 action=drop log=yes log-prefix="NugaCore-SNMP-deny:" comment="NugaCore SNMP deny external"
}`;

const sectionFactoryLogging = (): string => `
# --- Logging NugaCore ---
:if ([:len [/system logging find comment~"NugaCore factory"]] = 0) do={
  /system logging add topics=critical,error,warning,info action=memory comment="NugaCore factory logging"
}`;

// ── LAN mínima (WAN + bridge opcional) ──────────────────────────────

const sectionMinimalLan = (d: Defaults): string => {
  const dhcpBlock = d.enableDhcp !== false
    ? sectionDhcp(d)
    : '\n# --- DHCP: deshabilitado por configuración WISP ---';
  return `
# --- WAN ---
:if ([:len [/interface list find name=WAN]] = 0) do={ /interface list add name=WAN }
:if ([:len [/interface list member find interface="${d.wan}" list=WAN]] = 0) do={
  /interface list member add interface="${d.wan}" list=WAN comment="NugaCore WAN"
}
${sectionBridge(d)}
${sectionInterfaceLists(d)}
${sectionLanIp(d)}
${dhcpBlock}
${sectionNat(d)}
${sectionFirewall()}`;
};

// ── Sección WireGuard (client/tunnel) ─────────────────────────────

interface WgSectionResult {
  section: string;
  warnings: string[];
}

const sectionWireguard = (p: TemplateLibraryParams): WgSectionResult => {
  const warnings: string[] = [];
  const pubKey = p.wgServerPublicKey || '<PEGAR_PUBLIC_KEY_DEL_SERVIDOR>';
  const routerIp = p.wgRouterIp || '<IP_PEER>/32';
  const mgmtCidr = p.wgManagementCidr || '10.10.0.0/24';
  const keepalive = p.wgKeepalive ?? 25;

  let epHost = '<ENDPOINT_HOST>';
  let epPort = '13231';
  if (p.wgEndpoint?.includes(':')) {
    [epHost, epPort] = p.wgEndpoint.split(':');
  } else if (p.wgEndpoint) {
    epHost = p.wgEndpoint;
  }

  if (!p.wgServerPublicKey) warnings.push('wgServerPublicKey no configurada: el script usa un placeholder.');
  if (!p.wgEndpoint) warnings.push('wgEndpoint no configurado: completar host:port del servidor WireGuard.');
  if (!p.wgRouterIp) warnings.push('wgRouterIp no configurada: asignar la IP del peer en la red WG.');

  const ifaceLine = p.wgPrivateKey
    ? `  add name="NugaCoreWG" listen-port=13231 private-key="${p.wgPrivateKey}" comment="NugaCore WireGuard"`
    : `  add name="NugaCoreWG" listen-port=13231 comment="NugaCore WireGuard (RouterOS auto-genera private-key)"`;

  const note = p.wgPrivateKey
    ? `# Peer pre-registrado en WireGuard Manager. El túnel se levanta automáticamente.`
    : `# Tras importar: copiar la public-key generada y registrarla en NugaCore WG Manager.
#   /interface wireguard print where name=NugaCoreWG`;

  const section = `
# --- WireGuard tunnel NugaCore ---
${note}
:if ([:len [/interface wireguard find name="NugaCoreWG"]] = 0) do={
${ifaceLine}
}
:if ([:len [/ip address find interface="NugaCoreWG" comment~"NugaCore"]] = 0) do={
  /ip address add address="${routerIp}" interface="NugaCoreWG" comment="NugaCore WG address"
}
:if ([:len [/interface wireguard peers find comment~"NugaCore WG server"]] = 0) do={
  /interface wireguard peers add \\
    interface="NugaCoreWG" \\
    public-key="${pubKey}" \\
    endpoint-address=${epHost} \\
    endpoint-port=${epPort} \\
    allowed-address=${mgmtCidr} \\
    persistent-keepalive=${keepalive}s \\
    comment="NugaCore WG server peer"
}
:if ([:len [/ip route find dst-address="${mgmtCidr}" comment~"NugaCore"]] = 0) do={
  /ip route add dst-address="${mgmtCidr}" gateway=NugaCoreWG comment="NugaCore management route"
}
# --- Watchdog WireGuard ---
:if ([:len [/system scheduler find name="NugaCore-WG-Watchdog"]] = 0) do={
  /system scheduler add name="NugaCore-WG-Watchdog" interval=00:05:00 \\
    on-event=":log info \\"NugaCore WG watchdog: peer activo\\"" \\
    comment="NugaCore WG watchdog"
}`;

  return { section, warnings };
};

// ── Sección SSTP ──────────────────────────────────────────────────

const sectionSstp = (p: TemplateLibraryParams, vpnUser: string, vpnPass: string): WgSectionResult => {
  const warnings: string[] = [];
  const host = p.sstpHost || '<HOST_CONCENTRADOR_NUGACORE>';
  const mgmtCidr = p.sstpManagementCidr || '10.10.0.0/24';

  if (!p.sstpHost) warnings.push('sstpHost no configurado: completar el FQDN/IP del concentrador SSTP.');

  const section = `
# --- SSTP tunnel NugaCore ---
:if ([:len [/ppp profile find name="nugacore-profile"]] = 0) do={
  /ppp profile add name="nugacore-profile" comment="NugaCore VPN profile"
}
:if ([:len [/interface sstp-client find name="NugaCoreVPN"]] = 0) do={
  /interface sstp-client add name="NugaCoreVPN" \\
    connect-to="${host}" \\
    user="${vpnUser}" \\
    password="${vpnPass}" \\
    profile="nugacore-profile" \\
    add-default-route=no \\
    disabled=no \\
    comment="NugaCore VPN"
}
:if ([:len [/ip route find dst-address="${mgmtCidr}" comment~"NugaCore"]] = 0) do={
  /ip route add dst-address="${mgmtCidr}" gateway=NugaCoreVPN comment="NugaCore management route"
}
# --- Watchdog SSTP ---
:if ([:len [/system scheduler find name="NugaCore-VPN-Watchdog"]] = 0) do={
  /system scheduler add name="NugaCore-VPN-Watchdog" interval=00:01:00 \\
    on-event="/interface sstp-client enable [find name=NugaCoreVPN disabled=yes]" \\
    comment="NugaCore VPN watchdog"
}`;

  return { section, warnings };
};

// ── Generadores por plantilla ─────────────────────────────────────

interface GenResult {
  script: string;
  apiUsername?: string;
  snmpCommunity?: string;
  warnings: string[];
}

const genRouterBaseWireguard = (p: TemplateLibraryParams): GenResult => {
  const d = getDefaults(p);
  const cred = generateApiCredential(p.routerName);
  const { section: wgSection, warnings } = sectionWireguard(p);
  const allowedCidr = p.wgVpnCidr || p.wgManagementCidr || d.apiCidr;

  const script = [
    header(p, 'Router Base WISP + WireGuard NugaCore'),
    `\n# --- Limpieza NugaCore previa ---`,
    `/user remove [find where name~"nugacore_"]`,
    `/user group remove [find where name="nugacore"]`,
    `/ip route remove [find where comment~"NugaCore"]`,
    `/ip address remove [find where comment~"NugaCore"]`,
    `/ip firewall filter remove [find where comment~"NugaCore"]`,
    `/ip firewall nat remove [find where comment~"NugaCore"]`,
    sectionIdentity(p.routerName),
    sectionBridge(d),
    sectionInterfaceLists(d),
    sectionLanIp(d),
    sectionDhcp(d),
    sectionNat(d),
    sectionFirewall(),
    sectionApiUser(cred.username, cred.plainPassword, allowedCidr, d.apiPort),
    wgSection,
    sectionSystemNote(p.routerName, 'Router Base WISP + WireGuard'),
    sectionFileCleanup(),
  ].join('\n');

  return { script, apiUsername: cred.username, warnings };
};

const genFactoryOnboarding = (p: TemplateLibraryParams): GenResult => {
  const d = getDefaults(p);
  const cred = generateApiCredential(p.routerName);
  const snmpCommunity = p.snmpCommunity || generateSnmpCommunity(p.routerName);
  const { section: wgSection, warnings } = sectionWireguard(p);
  const vpnCidr = p.wgVpnCidr || p.wgManagementCidr || d.apiCidr;
  const snmpCidr = p.snmpMgmtCidr || vpnCidr;
  const zoneName = p.zoneName || p.routerName;

  const script = [
    header(p, 'Factory Reset — WG + API + SNMP'),
    `\n# --- Limpieza NugaCore previa ---`,
    `/user remove [find where name~"nugacore_"]`,
    `/user group remove [find where name="nugacore"]`,
    `/snmp community remove [find where comment~"NugaCore"]`,
    `/ip route remove [find where comment~"NugaCore"]`,
    `/ip address remove [find where comment~"NugaCore"]`,
    `/ip firewall filter remove [find where comment~"NugaCore"]`,
    `/ip firewall nat remove [find where comment~"NugaCore"]`,
    sectionIdentity(p.routerName),
    sectionMinimalLan(d),
    sectionApiUser(cred.username, cred.plainPassword, vpnCidr, d.apiPort),
    wgSection,
    sectionSnmp(snmpCommunity, snmpCidr, zoneName),
    sectionFactoryFirewall(vpnCidr, d.apiPort),
    sectionFactoryLogging(),
    `# --- Watchdog sistema ---`,
    `:if ([:len [/system scheduler find name="NugaCore-Factory-Watchdog"]] = 0) do={`,
    `  /system scheduler add name="NugaCore-Factory-Watchdog" interval=00:10:00 \\`,
    `    on-event=":log info \\"NugaCore factory: sistema activo\\"" \\`,
    `    comment="NugaCore factory watchdog"`,
    `}`,
    sectionSystemNote(p.routerName, 'Factory Reset — WG + API + SNMP'),
    sectionFileCleanup(),
  ].join('\n');

  return { script, apiUsername: cred.username, snmpCommunity, warnings };
};

const genRouterBaseSstp = (p: TemplateLibraryParams): GenResult => {
  const d = getDefaults(p);
  const cred = generateApiCredential(p.routerName);
  const vpnCred = generateApiCredential(`vpn_${p.routerName}`);
  const { section: sstpSection, warnings } = sectionSstp(p, vpnCred.username, vpnCred.plainPassword);
  const allowedCidr = p.sstpManagementCidr || d.apiCidr;

  const script = [
    header(p, 'Router Base WISP + SSTP NugaCore'),
    `\n# --- Limpieza NugaCore previa ---`,
    `/user remove [find where name~"nugacore_"]`,
    `/user group remove [find where name="nugacore"]`,
    `/ip route remove [find where comment~"NugaCore"]`,
    `/ip address remove [find where comment~"NugaCore"]`,
    `/ip firewall filter remove [find where comment~"NugaCore"]`,
    `/ip firewall nat remove [find where comment~"NugaCore"]`,
    sectionIdentity(p.routerName),
    sectionBridge(d),
    sectionInterfaceLists(d),
    sectionLanIp(d),
    sectionDhcp(d),
    sectionNat(d),
    sectionFirewall(),
    sectionApiUser(cred.username, cred.plainPassword, allowedCidr, d.apiPort),
    sstpSection,
    sectionSystemNote(p.routerName, 'Router Base WISP + SSTP'),
    sectionFileCleanup(),
  ].join('\n');

  return { script, apiUsername: cred.username, warnings };
};

const genClientResidential = (p: TemplateLibraryParams): GenResult => {
  const d = getDefaults(p);
  const warnings: string[] = [];
  const useWg = !!(p.wgServerPublicKey && p.wgEndpoint);

  let wgSection: string;
  if (useWg) {
    const result = sectionWireguard(p);
    wgSection = result.section;
    warnings.push(...result.warnings);
  } else {
    wgSection = '\n# --- WireGuard: no configurado (opcional para gestión remota) ---';
  }

  const script = [
    header(p, 'Router Residencial'),
    sectionIdentity(p.routerName),
    sectionBridge(d),
    sectionInterfaceLists(d),
    sectionLanIp(d),
    sectionDhcp(d),
    sectionNat(d),
    sectionFirewall(),
    wgSection,
    sectionSystemNote(p.routerName, 'Router Residencial'),
    sectionFileCleanup(),
  ].join('\n');

  return { script, warnings };
};

const genTowerWisp = (p: TemplateLibraryParams): GenResult => {
  const d = getDefaults(p);
  const cred = generateApiCredential(p.routerName);
  const { section: wgSection, warnings } = sectionWireguard(p);
  const mgmtVlan = p.vlanManagement ?? 100;
  const clientVlan = p.vlanClients ?? 200;
  const backhaulVlan = p.vlanBackhaul ?? 300;
  const useVlans = p.enableVlans !== false;

  const vlanSection = useVlans
    ? `
# --- VLANs torre ---
:if ([:len [/interface vlan find name="vlan-mgmt"]] = 0) do={
  /interface vlan add name="vlan-mgmt" vlan-id=${mgmtVlan} interface="${d.bridge}" comment="NugaCore Management VLAN"
}
:if ([:len [/interface vlan find name="vlan-clients"]] = 0) do={
  /interface vlan add name="vlan-clients" vlan-id=${clientVlan} interface="${d.bridge}" comment="NugaCore Clients VLAN"
}
:if ([:len [/interface vlan find name="vlan-backhaul"]] = 0) do={
  /interface vlan add name="vlan-backhaul" vlan-id=${backhaulVlan} interface="${d.bridge}" comment="NugaCore Backhaul VLAN"
}`
    : '\n# --- VLANs: deshabilitadas por configuración ---';

  const schedulerSection = `
# --- Scheduler NugaCore ---
:if ([:len [/system scheduler find name="NugaCore-Backup"]] = 0) do={
  /system scheduler add name="NugaCore-Backup" interval=1d start-time=03:00:00 \\
    on-event="/system backup save name=nugacore-auto-backup" \\
    comment="NugaCore daily backup"
}
:if ([:len [/system scheduler find name="NugaCore-LogRotate"]] = 0) do={
  /system scheduler add name="NugaCore-LogRotate" interval=1d start-time=04:00:00 \\
    on-event="/log info \\"NugaCore Torre: log rotation check\\"" \\
    comment="NugaCore log rotate"
}`;

  const script = [
    header(p, 'Torre WISP (RB5009 / CCR)'),
    sectionIdentity(p.routerName),
    sectionBridge(d),
    vlanSection,
    sectionInterfaceLists(d),
    sectionLanIp(d),
    sectionDhcp(d),
    sectionNat(d),
    sectionFirewall(),
    sectionApiUser(cred.username, cred.plainPassword, p.wgManagementCidr || d.apiCidr, d.apiPort),
    wgSection,
    schedulerSection,
    sectionSystemNote(p.routerName, 'Torre WISP'),
    sectionFileCleanup(),
  ].join('\n');

  return { script, apiUsername: cred.username, warnings };
};

// ── PCC Generator (genérico para N WANs) ─────────────────────────

const genPcc = (p: TemplateLibraryParams, wanCount: number): GenResult => {
  const d = getDefaults(p);
  const warnings: string[] = [];
  const wanIfaces = (p.wanInterfaces || []).slice(0, wanCount);
  const wanGws = (p.wanGateways || []).slice(0, wanCount);

  // Pad with placeholders if not enough provided
  while (wanIfaces.length < wanCount) wanIfaces.push(`ether${wanIfaces.length + 1}`);
  while (wanGws.length < wanCount) {
    wanGws.push(`<GATEWAY_WAN${wanGws.length + 1}>`);
    warnings.push(`wanGateways[${wanGws.length - 1}] no configurado: completar la IP del gateway WAN${wanGws.length}.`);
  }

  const useV7 = p.routerosVersion === '7';
  const templateName = `Balanceo PCC — ${wanCount} WAN`;

  // Interface lists
  const wanListEntries = wanIfaces
    .map(
      (iface, i) =>
        `:if ([:len [/interface list member find interface="${iface}" list=WAN]] = 0) do={
  /interface list member add interface="${iface}" list=WAN comment="NugaCore WAN${i + 1}"
}`,
    )
    .join('\n');

  // Routing tables (v7 only)
  const routingTables = useV7
    ? wanIfaces
        .map(
          (_, i) =>
            `:if ([:len [/routing table find name="to-isp${i + 1}"]] = 0) do={
  /routing table add name="to-isp${i + 1}" fib comment="NugaCore ISP${i + 1}"
}`,
        )
        .join('\n')
    : '# Routing tables: en RouterOS v6 se usan routing-mark (ver mangle)';

  // Mangle rules (PCC)
  const mangleRules = wanIfaces
    .map(
      (_, i) => `# WAN${i + 1}: marca conn y routing
:if ([:len [/ip firewall mangle find comment~"NugaCore PCC conn-${i + 1}"]] = 0) do={
  /ip firewall mangle add chain=prerouting in-interface="${d.bridge}" \\
    connection-state=new action=mark-connection new-connection-mark="conn-isp${i + 1}" \\
    per-connection-classifier=both-addresses-and-ports:${wanCount}/${i} passthrough=yes \\
    comment="NugaCore PCC conn-${i + 1}"
}
:if ([:len [/ip firewall mangle find comment~"NugaCore PCC route-${i + 1}"]] = 0) do={
  /ip firewall mangle add chain=prerouting in-interface="${d.bridge}" \\
    connection-mark="conn-isp${i + 1}" action=mark-routing new-routing-mark="to-isp${i + 1}" \\
    passthrough=no comment="NugaCore PCC route-${i + 1}"
}`,
    )
    .join('\n');

  // Routes per ISP
  const ispRoutes = wanIfaces
    .map((_, i) => {
      if (useV7) {
        return `/ip route add dst-address=0.0.0.0/0 gateway=${wanGws[i]} routing-table=to-isp${i + 1} distance=${i + 1} comment="NugaCore ISP${i + 1} PCC route"`;
      } else {
        return `/ip route add dst-address=0.0.0.0/0 gateway=${wanGws[i]} routing-mark=to-isp${i + 1} distance=${i + 1} comment="NugaCore ISP${i + 1} PCC route"`;
      }
    })
    .join('\n');

  // Failover routes (fallback principal + alternate distances)
  const failoverRoutes = wanGws
    .map((gw, i) => `/ip route add dst-address=0.0.0.0/0 gateway=${gw} distance=${i + 1} comment="NugaCore failover ISP${i + 1}"`)
    .join('\n');

  // Netwatch (si failover habilitado)
  const enableFailover = p.pccEnableFailover !== false;
  const netwatchSection = enableFailover
    ? wanIfaces
        .map(
          (iface, i) => `# Netwatch ISP${i + 1}
:if ([:len [/tool netwatch find comment~"NugaCore Netwatch ISP${i + 1}"]] = 0) do={
  /tool netwatch add host=${wanGws[i]} interval=10s timeout=3s \\
    up-script=":log info \\"NugaCore ISP${i + 1} UP\\"; /ip route set [find comment~\\"NugaCore failover ISP${i + 1}\\"] distance=${i + 1}" \\
    down-script=":log warning \\"NugaCore ISP${i + 1} DOWN\\"; /ip route set [find comment~\\"NugaCore failover ISP${i + 1}\\"] distance=${wanCount + i + 1}" \\
    comment="NugaCore Netwatch ISP${i + 1}"
}`,
        )
        .join('\n')
    : '# Failover Netwatch: deshabilitado por configuración';

  const watchdogSection =
    p.pccEnableWatchdog !== false
      ? `
# --- Watchdog PCC ---
:if ([:len [/system scheduler find name="NugaCore-PCC-Log"]] = 0) do={
  /system scheduler add name="NugaCore-PCC-Log" interval=00:15:00 \\
    on-event=":log info \\"NugaCore PCC: verificando rutas activas\\"" \\
    comment="NugaCore PCC watchdog"
}`
      : '';

  const script = [
    header(p, templateName),
    sectionIdentity(p.routerName),
    sectionBridge(d),
    `\n# --- Interface Lists PCC ---`,
    `:if ([:len [/interface list find name=WAN]] = 0) do={ /interface list add name=WAN }`,
    `:if ([:len [/interface list find name=LAN]] = 0) do={ /interface list add name=LAN }`,
    wanListEntries,
    `:if ([:len [/interface list member find interface="${d.bridge}" list=LAN]] = 0) do={
  /interface list member add interface="${d.bridge}" list=LAN comment="NugaCore LAN"
}`,
    sectionLanIp(d),
    sectionDhcp(d),
    `\n# --- Routing Tables ---`,
    routingTables,
    `\n# --- Mangle PCC ---`,
    mangleRules,
    `\n# --- Rutas por ISP ---`,
    ispRoutes,
    `\n# --- Rutas failover ---`,
    failoverRoutes,
    sectionNat(d),
    sectionFirewall(),
    `\n# --- Netwatch failover ---`,
    netwatchSection,
    watchdogSection,
    sectionSystemNote(p.routerName, templateName),
    sectionFileCleanup(),
  ].join('\n');

  return { script, warnings };
};

const genPppoeServer = (p: TemplateLibraryParams): GenResult => {
  const warnings: string[] = [];
  const iface = p.pppoeInterface || 'bridge-lan';
  const service = p.pppoeServiceName || 'pppoe-nugacore';
  const localIp = p.pppoeLocalIp || '10.100.0.1';
  const poolStart = p.pppoeRemotePoolStart || '10.100.0.2';
  const poolEnd = p.pppoeRemotePoolEnd || '10.100.0.254';

  const script = `${header(p, 'Servidor PPPoE')}
${sectionIdentity(p.routerName)}

# --- Pool de IPs PPPoE ---
:if ([:len [/ip pool find name="NugaCore-pppoe-pool"]] = 0) do={
  /ip pool add name="NugaCore-pppoe-pool" ranges="${poolStart}-${poolEnd}" comment="NugaCore PPPoE pool"
}

# --- Perfiles de velocidad PPPoE ---
:if ([:len [/ppp profile find name="NugaCore-1M"]] = 0) do={
  /ppp profile add name="NugaCore-1M" local-address="${localIp}" \\
    remote-address="NugaCore-pppoe-pool" rate-limit="1M/1M" \\
    dns-server="8.8.8.8,1.1.1.1" comment="NugaCore 1Mbps"
}
:if ([:len [/ppp profile find name="NugaCore-5M"]] = 0) do={
  /ppp profile add name="NugaCore-5M" local-address="${localIp}" \\
    remote-address="NugaCore-pppoe-pool" rate-limit="5M/5M" \\
    dns-server="8.8.8.8,1.1.1.1" comment="NugaCore 5Mbps"
}
:if ([:len [/ppp profile find name="NugaCore-10M"]] = 0) do={
  /ppp profile add name="NugaCore-10M" local-address="${localIp}" \\
    remote-address="NugaCore-pppoe-pool" rate-limit="10M/10M" \\
    dns-server="8.8.8.8,1.1.1.1" comment="NugaCore 10Mbps"
}

# --- Servidor PPPoE ---
:if ([:len [/interface pppoe-server server find service-name="${service}"]] = 0) do={
  /interface pppoe-server server add service-name="${service}" \\
    interface="${iface}" default-profile="NugaCore-1M" \\
    authentication=chap,mschap2 disabled=no \\
    comment="NugaCore PPPoE server"
}

# --- Secrets de ejemplo (CAMBIAR antes de producción) ---
# /ppp secret add name="cliente01" password="CAMBIAR_PASSWORD" profile="NugaCore-5M" service=pppoe comment="NugaCore ejemplo"
# /ppp secret add name="cliente02" password="CAMBIAR_PASSWORD" profile="NugaCore-10M" service=pppoe comment="NugaCore ejemplo"

# --- Queue tree simple (por perfil) ---
:if ([:len [/queue simple find name="NugaCore-QOS-1M"]] = 0) do={
  /queue simple add name="NugaCore-QOS-1M" max-limit="1M/1M" target="" comment="NugaCore QoS 1M"
}
:if ([:len [/queue simple find name="NugaCore-QOS-5M"]] = 0) do={
  /queue simple add name="NugaCore-QOS-5M" max-limit="5M/5M" target="" comment="NugaCore QoS 5M"
}

# --- NAT para clientes PPPoE ---
:if ([:len [/ip firewall nat find action=masquerade chain=srcnat comment~"NugaCore PPPoE NAT"]] = 0) do={
  /ip firewall nat add action=masquerade chain=srcnat out-interface-list=WAN comment="NugaCore PPPoE NAT"
}
${sectionSystemNote(p.routerName, 'Servidor PPPoE')}
${sectionFileCleanup()}`;

  return { script, warnings };
};

const genMonitoringAgent = (p: TemplateLibraryParams): GenResult => {
  const warnings: string[] = [];
  const watchTarget = p.watchdogTarget || '8.8.8.8';
  const enableBackup = p.enableAutoBackup !== false;
  const enableWatchdog = p.enableWatchdog !== false;

  const watchdogSection = enableWatchdog
    ? `
# --- Watchdog de conectividad ---
:if ([:len [/tool netwatch find comment~"NugaCore Watchdog"]] = 0) do={
  /tool netwatch add host="${watchTarget}" interval=30s timeout=5s \\
    up-script=":log info \\"NugaCore monitor: conectividad OK\\"" \\
    down-script=":log warning \\"NugaCore monitor: sin conectividad a ${watchTarget}\\"" \\
    comment="NugaCore Watchdog"
}`
    : '\n# --- Watchdog: deshabilitado por configuración ---';

  const backupSection = enableBackup
    ? `
# --- Backup automático diario ---
:if ([:len [/system scheduler find name="NugaCore-AutoBackup"]] = 0) do={
  /system scheduler add name="NugaCore-AutoBackup" interval=1d start-time=02:30:00 \\
    on-event="/system backup save name=nugacore-backup" \\
    comment="NugaCore backup diario"
}`
    : '\n# --- Backup automático: deshabilitado por configuración ---';

  const script = `${header(p, 'Agente de Monitoreo')}
${sectionIdentity(p.routerName)}

# --- Logging NugaCore ---
:if ([:len [/system logging find comment~"NugaCore"]] = 0) do={
  /system logging add topics=critical,error,warning,info action=memory comment="NugaCore logging"
}
${watchdogSection}

# --- Scheduler métricas del sistema ---
:if ([:len [/system scheduler find name="NugaCore-Metrics"]] = 0) do={
  /system scheduler add name="NugaCore-Metrics" interval=00:10:00 \\
    on-event=":log info \\"NugaCore metrics: CPU=[$([/system resource get cpu-load])]% FreeRAM=[$([/system resource get free-memory])]b\\"" \\
    comment="NugaCore system metrics"
}
${backupSection}

# --- Scheduler log rotation check ---
:if ([:len [/system scheduler find name="NugaCore-LogCheck"]] = 0) do={
  /system scheduler add name="NugaCore-LogCheck" interval=1d start-time=01:00:00 \\
    on-event=":log info \\"NugaCore log check: sistema activo\\"" \\
    comment="NugaCore log rotation check"
}
${sectionSystemNote(p.routerName, 'Agente de Monitoreo')}
${sectionFileCleanup()}`;

  return { script, warnings };
};

const genWireguardClient = (p: TemplateLibraryParams): GenResult => {
  const { section: wgSection, warnings } = sectionWireguard(p);
  const vpnCidr = p.wgVpnCidr || p.wgManagementCidr || '10.10.0.0/24';

  const script = `${header(p, 'WireGuard Cliente')}
${sectionIdentity(p.routerName)}
# --- Cliente WireGuard integrado con NugaCore WG Manager ---
${wgSection}

# --- Routing para red VPN ---
:if ([:len [/ip route find dst-address="${vpnCidr}" comment~"NugaCore VPN"]] = 0) do={
  /ip route add dst-address="${vpnCidr}" gateway=NugaCoreWG comment="NugaCore VPN route"
}

# --- Firewall: permite tráfico WireGuard ---
:if ([:len [/ip firewall filter find chain=input protocol=udp dst-port=13231 comment~"NugaCore WG"]] = 0) do={
  /ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="NugaCore WG UDP"
}
${sectionSystemNote(p.routerName, 'WireGuard Cliente')}
${sectionFileCleanup()}`;

  return { script, warnings };
};

const genWireguardServer = (p: TemplateLibraryParams): GenResult => {
  const warnings: string[] = [];
  const serverIp = p.wgRouterIp || '10.10.0.1/24';
  const vpnCidr = p.wgVpnCidr || '10.10.0.0/24';
  const apiCidr = p.nocApiCidr || p.apiCidr || '10.0.0.0/24';
  const apiPort = p.apiPort ?? 8728;
  const cred = generateApiCredential(p.routerName);

  const serverNote = p.wgPrivateKey
    ? `# Servidor con clave privada pre-configurada (NugaCore WG Manager).`
    : `# RouterOS auto-genera la private-key. Exportar la public-key y registrarla.
# /interface wireguard print where name=NugaCoreWG-Server`;

  const script = `${header(p, 'WireGuard Servidor')}
${sectionIdentity(p.routerName)}

# --- Servidor WireGuard NugaCore ---
${serverNote}
:if ([:len [/interface wireguard find name="NugaCoreWG-Server"]] = 0) do={
  ${
    p.wgPrivateKey
      ? `/interface wireguard add name="NugaCoreWG-Server" listen-port=13231 private-key="${p.wgPrivateKey}" comment="NugaCore WG Server"`
      : `/interface wireguard add name="NugaCoreWG-Server" listen-port=13231 comment="NugaCore WG Server"`
  }
}
:if ([:len [/ip address find interface="NugaCoreWG-Server" comment~"NugaCore"]] = 0) do={
  /ip address add address="${serverIp}" interface="NugaCoreWG-Server" comment="NugaCore WG Server IP"
}

# --- Firewall WireGuard ---
:if ([:len [/ip firewall filter find chain=input protocol=udp dst-port=13231 comment~"NugaCore WG Server"]] = 0) do={
  /ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="NugaCore WG Server port"
}
:if ([:len [/ip firewall filter find chain=forward in-interface="NugaCoreWG-Server" comment~"NugaCore WG forward"]] = 0) do={
  /ip firewall filter add chain=forward in-interface="NugaCoreWG-Server" action=accept comment="NugaCore WG forward"
}

# --- NAT para red WireGuard ---
:if ([:len [/ip firewall nat find chain=srcnat src-address="${vpnCidr}" comment~"NugaCore WG NAT"]] = 0) do={
  /ip firewall nat add chain=srcnat src-address="${vpnCidr}" action=masquerade comment="NugaCore WG NAT"
}

${sectionApiUser(cred.username, cred.plainPassword, apiCidr, apiPort)}
${sectionSystemNote(p.routerName, 'WireGuard Servidor')}
${sectionFileCleanup()}`;

  return { script, apiUsername: cred.username, warnings };
};

const genNocReady = (p: TemplateLibraryParams): GenResult => {
  const warnings: string[] = [];
  const apiCidr = p.nocApiCidr || p.apiCidr || '10.0.0.0/24';
  const apiPort = p.apiPort ?? 8728;
  const cred = generateApiCredential(p.routerName);

  const apiSslSection = p.enableApiSsl
    ? `
# --- API-SSL habilitada ---
/ip service set api-ssl address="${apiCidr}" disabled=no`
    : `
# --- API-SSL deshabilitada (usar api sobre VPN) ---
/ip service disable api-ssl`;

  const script = `${header(p, 'NOC Ready')}
${sectionIdentity(p.routerName)}

# --- Servicios seguros: desactivar lo que no se usa ---
/ip service disable telnet
/ip service disable www
/ip service disable www-ssl

# --- Grupo NOC con permisos mínimos ---
:if ([:len [/user group find name="nugacore"]] = 0) do={
  /user group add name="nugacore" policy="${NUGACORE_GROUP_POLICY}" comment="NugaCore NOC group"
}

# --- Usuario NOC NugaCore ---
# El password se muestra UNA SOLA VEZ. Guardar este script ahora.
/user add name="${cred.username}" password="${cred.plainPassword}" group="nugacore" comment="NugaCore NOC API user"

# --- API limitada al CIDR de gestión ---
/ip service set api port=${apiPort} address="${apiCidr}" disabled=no
${apiSslSection}

# --- Logging estructurado ---
:if ([:len [/system logging find comment~"NugaCore NOC"]] = 0) do={
  /system logging add topics=critical,error,warning,system action=memory comment="NugaCore NOC logging"
}

# --- Auditoría de acceso API ---
:if ([:len [/ip firewall filter find chain=input dst-port=${apiPort} comment~"NugaCore API audit"]] = 0) do={
  /ip firewall filter add chain=input protocol=tcp dst-port=${apiPort} \\
    src-address="${apiCidr}" action=accept comment="NugaCore API audit allow"
}
:if ([:len [/ip firewall filter find chain=input dst-port=${apiPort} action=drop comment~"NugaCore API deny"]] = 0) do={
  /ip firewall filter add chain=input protocol=tcp dst-port=${apiPort} \\
    action=drop log=yes log-prefix="NugaCore-API-deny:" comment="NugaCore API deny external"
}

# --- Watchdog de sistema ---
:if ([:len [/system scheduler find name="NugaCore-NOC-Watchdog"]] = 0) do={
  /system scheduler add name="NugaCore-NOC-Watchdog" interval=00:10:00 \\
    on-event=":log info \\"NugaCore NOC: sistema activo - usuario ${cred.username}\\"" \\
    comment="NugaCore NOC watchdog"
}
${sectionSystemNote(p.routerName, 'NOC Ready')}
${sectionFileCleanup()}`;

  return { script, apiUsername: cred.username, warnings };
};

// ── Dispatcher principal ──────────────────────────────────────────

const dispatch = (p: TemplateLibraryParams): GenResult => {
  switch (p.templateId) {
    case 'nugacore_factory_onboarding': return genFactoryOnboarding(p);
    case 'router_base_wireguard': return genRouterBaseWireguard(p);
    case 'router_base_sstp':     return genRouterBaseSstp(p);
    case 'client_residential':   return genClientResidential(p);
    case 'tower_wisp':           return genTowerWisp(p);
    case 'pcc_2wan':             return genPcc(p, 2);
    case 'pcc_3wan':             return genPcc(p, 3);
    case 'pcc_4wan':             return genPcc(p, 4);
    case 'pcc_5wan':             return genPcc(p, 5);
    case 'pppoe_server':         return genPppoeServer(p);
    case 'monitoring_agent':     return genMonitoringAgent(p);
    case 'wireguard_client':     return genWireguardClient(p);
    case 'wireguard_server':     return genWireguardServer(p);
    case 'noc_ready':            return genNocReady(p);
  }
};

// ── Punto de entrada público ──────────────────────────────────────

export function generateFromTemplate(params: TemplateLibraryParams): TemplateGeneratedResource {
  const { script, apiUsername, snmpCommunity, warnings } = dispatch(params);

  assertNoBrandViolation(script);
  assertNoForbiddenPolicies(script);
  assertNoForbiddenKeywords(script);

  const scriptHash = sha256Short(script);
  const filename = buildTemplateFilename(params.routerName, params.templateId);

  return {
    script,
    scriptHash,
    filename,
    templateId: params.templateId,
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
    warnings,
    generatedAt: new Date().toISOString(),
    apiUsername,
    snmpCommunity,
  };
}
