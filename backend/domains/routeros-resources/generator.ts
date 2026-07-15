// ====================================================================
// Generador de scripts RouterOS para recursos NugaCore (Fase 4.6.2).
//
// Produce scripts .rsc completos y seguros para WISP. El script:
//   - es idempotente (prefijo NugaCore en comments para aislar config propia)
//   - usa permisos mínimos (read,write,api,test — sin sniff/sensitive/romon)
//   - incluye LAN, DHCP, NAT, firewall básico, usuario API, VPN, watchdog
//   - contiene secretos solo UNA VEZ; el llamador nunca persiste el script
//
// Prefijos: NugaCore / nugacore / NUGACORE. Nunca branding externo.
// ====================================================================

import { createHash } from 'crypto';
import { generateApiCredential } from '../mikrotik/provisioning/credentials';
import { NUGACORE_GROUP_POLICY } from '../mikrotik/provisioning/script-generator';
import { ResourceGeneratorParams, GeneratedResource, RESOURCE_GENERATOR_VERSION } from './types';
import { buildFilename, assertNoBrandViolation, assertNoForbiddenPolicies } from './safe-rsc';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

// ── Helpers de secciones ──────────────────────────────────────────────

const scriptHeader = (p: ResourceGeneratorParams, templateLabel: string): string => {
  const date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `# ============================================================
# NugaCore — Resource Generator Script
# Plantilla: ${templateLabel}
# Router: ${p.routerName}
# Generado: ${date} UTC
# Version: ${RESOURCE_GENERATOR_VERSION}
# RouterOS: v${p.routerosVersion === '7' ? '7+' : '6+'}
# ============================================================
# ADVERTENCIA: Haz un backup antes de importar este script.
#   /system backup save name=backup-pre-nugacore
# Importar con:
#   /import file-name=<nombre-del-archivo.rsc>
# ============================================================`;
};

const sectionCleanup = (_p: ResourceGeneratorParams): string => `
# --- 1. Limpieza idempotente de configuracion NugaCore previa ---
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/ip route remove [find where comment~"NugaCore"]
/ip address remove [find where comment~"NugaCore LAN"]
/ip firewall filter remove [find where comment~"NugaCore"]
/ip firewall nat remove [find where comment~"NugaCore"]`;

const sectionIdentity = (p: ResourceGeneratorParams): string => `
# --- 2. Identidad del router ---
/system identity set name="${p.routerName}"`;

const sectionBridge = (p: ResourceGeneratorParams): string => {
  const bridgeAdd = `/interface bridge
:if ([:len [find name="${p.lanBridgeName}"]] = 0) do={
  add name="${p.lanBridgeName}" fast-forward=no comment="NugaCore LAN bridge"
}`;

  const portAdds = p.lanInterfaces
    .map(
      (iface) =>
        `/interface bridge port
:if ([:len [find interface="${iface}" bridge="${p.lanBridgeName}"]] = 0) do={
  add interface="${iface}" bridge="${p.lanBridgeName}" comment="NugaCore"
}`,
    )
    .join('\n');

  return `
# --- 3. Bridge LAN y puertos ---
${bridgeAdd}

# --- 4. Puertos LAN al bridge ---
${portAdds}`;
};

const sectionInterfaceLists = (p: ResourceGeneratorParams): string => `
# --- 5. Interface Lists (WAN / LAN) ---
/interface list
:if ([:len [find name=WAN]] = 0) do={ add name=WAN }
:if ([:len [find name=LAN]] = 0) do={ add name=LAN }
/interface list member
:if ([:len [find interface="${p.wanInterface}" list=WAN]] = 0) do={
  add interface="${p.wanInterface}" list=WAN comment="NugaCore WAN"
}
:if ([:len [find interface="${p.lanBridgeName}" list=LAN]] = 0) do={
  add interface="${p.lanBridgeName}" list=LAN comment="NugaCore LAN"
}`;

const sectionIpLan = (p: ResourceGeneratorParams): string => {
  const prefix = p.lanCidr.split('/')[1] || '24';
  return `
# --- 6. Direccion IP del gateway LAN ---
/ip address
:if ([:len [find address="${p.lanGateway}/${prefix}" interface="${p.lanBridgeName}"]] = 0) do={
  add address="${p.lanGateway}/${prefix}" interface="${p.lanBridgeName}" comment="NugaCore LAN"
}`;
};

const sectionDhcp = (p: ResourceGeneratorParams): string => {
  if (!p.enableDhcpServer) return '\n# --- 7. DHCP Server deshabilitado por configuracion ---';
  const dnsStr = p.dnsServers.join(',');
  const prefix = p.lanCidr.split('/')[1] || '24';
  return `
# --- 7. DHCP Pool ---
/ip pool
:if ([:len [find name="NugaCore-pool-LAN"]] = 0) do={
  add name="NugaCore-pool-LAN" ranges="${p.dhcpPoolStart}-${p.dhcpPoolEnd}"
}

# --- 8. DHCP Server ---
/ip dhcp-server
:if ([:len [find name="NugaCore-dhcp-LAN"]] = 0) do={
  add interface="${p.lanBridgeName}" address-pool="NugaCore-pool-LAN" disabled=no name="NugaCore-dhcp-LAN"
}
/ip dhcp-server network
:if ([:len [find address="${p.lanCidr}"]] = 0) do={
  add address="${p.lanCidr}" gateway="${p.lanGateway}" dns-server="${dnsStr}" netmask=${prefix} comment="NugaCore"
}`;
};

const sectionDns = (p: ResourceGeneratorParams): string => `
# --- 9. DNS ---
/ip dns set allow-remote-requests=yes servers="${p.dnsServers.join(',')}"`;

const sectionNat = (p: ResourceGeneratorParams): string => {
  if (!p.enableNat) return '\n# --- 10. NAT deshabilitado por configuracion ---';
  return `
# --- 10. NAT masquerade ---
/ip firewall nat
:if ([:len [find action=masquerade chain=srcnat out-interface-list=WAN comment~"NugaCore"]] = 0) do={
  add action=masquerade chain=srcnat out-interface-list=WAN comment="NugaCore NAT"
}`;
};

const sectionFirewall = (p: ResourceGeneratorParams): string => {
  if (!p.enableBasicFirewall) return '\n# --- 11. Firewall basico deshabilitado por configuracion ---';
  return `
# --- 11. Firewall basico (conservador) ---
# Permite conexiones establecidas/relacionadas (no interrumpe sesiones activas).
# Bloquea input externo no solicitado. No bloquea la interfaz VPN NugaCore.
/ip firewall filter
:if ([:len [find chain=input action=accept connection-state=established,related comment~"NugaCore"]] = 0) do={
  add chain=input action=accept connection-state=established,related comment="NugaCore allow established"
}
:if ([:len [find chain=input action=accept in-interface-list=LAN comment~"NugaCore"]] = 0) do={
  add chain=input action=accept in-interface-list=LAN comment="NugaCore allow LAN admin"
}
:if ([:len [find chain=input action=drop in-interface-list=WAN comment~"NugaCore"]] = 0) do={
  add chain=input action=drop in-interface-list=WAN comment="NugaCore drop WAN input"
}`;
};

const sectionUserAndGroup = (apiUser: string, apiPassword: string): string => `
# --- 12. Grupo NugaCore con permisos minimos ---
/user group
:if ([:len [find name="nugacore"]] = 0) do={
  add name="nugacore" policy="${NUGACORE_GROUP_POLICY}" comment="NugaCore minimal API group"
}

# --- 13. Usuario API NugaCore ---
# El password se muestra aqui UNA SOLA VEZ. Guarda este script ahora.
/user add name="${apiUser}" password="${apiPassword}" group="nugacore" comment="NugaCore API user"`;

const sectionApiService = (p: ResourceGeneratorParams, allowedCidr: string): string => `
# --- 14. API limitada al CIDR de la red VPN/gestion de NugaCore ---
# find !dynamic: ROS 7.19+ rechaza set api cuando hay sesiones dinámicas.
/ip service set [find where name="api" and dynamic=no] port=${p.apiPort} address=${allowedCidr} disabled=no`;

// ── Secciones específicas por plantilla ──────────────────────────────

const sectionWireguard = (p: ResourceGeneratorParams): { section: string; warnings: string[] } => {
  const warnings: string[] = [];
  const serverPublicKey = (p.wgServerPublicKey || '').trim();
  const routerIpRaw = (p.wgRouterIp || '').trim();
  const managementCidr = (p.wgManagementCidr || '').trim() || '10.70.0.0/16';
  const keepalive = p.wgKeepalive ?? 25;
  const endpoint = (p.wgEndpoint || '').trim();

  let endpointHost = '';
  let endpointPort = '13231';
  if (endpoint.includes(':')) {
    const idx = endpoint.lastIndexOf(':');
    endpointHost = endpoint.slice(0, idx);
    endpointPort = endpoint.slice(idx + 1) || '13231';
  } else if (endpoint) {
    endpointHost = endpoint;
  }

  const routerIp = routerIpRaw
    ? (routerIpRaw.includes('/') ? routerIpRaw : `${routerIpRaw}/32`)
    : '';
  const complete = Boolean(serverPublicKey && endpointHost && routerIp);

  if (!serverPublicKey) warnings.push('wgServerPublicKey faltante: no se emite peer (evita fallo en /import).');
  if (!endpointHost) warnings.push('wgEndpoint faltante: no se emite peer (evita fallo en /import).');
  if (!routerIp) warnings.push('wgRouterIp faltante: no se emite address WG (evita fallo en /import).');
  if (!complete) {
    warnings.push('WireGuard incompleto: solo se crea NugaCoreWG. Completa Public Key, Endpoint e IP peer y regenera.');
  }

  // private-key en SET top-level (no dentro de :if do={}) — paste/import-safe en CHR.
  const peerPk = (p.wgPeerPrivateKey || '').trim();
  const ifaceCreate =
    `/interface wireguard add name="NugaCoreWG" listen-port=13231 comment="NugaCore WireGuard"`;
  const privateKeySet = peerPk
    ? `/interface wireguard set [find name="NugaCoreWG"] private-key="${peerPk}"`
    : '';

  const wgNote = peerPk
    ? `# Peer pre-registrado en NugaCore WireGuard Manager.\n# Preferir /import del .rsc (no pegar en Terminal).`
    : `# Paso 1: Este script crea la interfaz WireGuard. RouterOS generara la private-key automaticamente.\n# Paso 2: Tras ejecutar el script, copia la public-key del router:\n#   /interface wireguard print where name=NugaCoreWG\n# Paso 3: Registra esa public-key en NugaCore para completar el tunel.`;

  const tunnelBlock = complete
    ? `:if ([:len [/ip address find interface="NugaCoreWG" comment~"NugaCore"]] = 0) do={
  /ip address add address="${routerIp}" interface="NugaCoreWG" comment="NugaCore WG address"
}
:if ([:len [/interface wireguard peers find comment~"NugaCore WG server"]] = 0) do={
  /interface wireguard peers add interface="NugaCoreWG" public-key="${serverPublicKey}" endpoint-address="${endpointHost}" endpoint-port=${endpointPort} allowed-address=${managementCidr} persistent-keepalive=${keepalive}s comment="NugaCore WG server peer"
}
:if ([:len [/ip route find dst-address="${managementCidr}" comment~"NugaCore"]] = 0) do={
  /ip route add dst-address="${managementCidr}" gateway=NugaCoreWG comment="NugaCore management route"
}`
    : `# WG incompleto: NO se emiten address/peer/route (placeholders abortaban /import en CHR).
:log warning "NugaCore WG incompleto: regenerar con datos WG reales"`;

  const section = `
# --- 15. WireGuard (RouterOS v7) ---
${wgNote}
:if ([:len [/interface wireguard find name="NugaCoreWG"]] = 0) do={
  ${ifaceCreate}
}
${privateKeySet}
${tunnelBlock}

# --- 16. Watchdog WireGuard ---
:if ([:len [/system scheduler find name="NugaCore-WG-Watchdog"]] = 0) do={
  /system scheduler add name="NugaCore-WG-Watchdog" interval=00:05:00 \\
      comment="NugaCore WG watchdog" \\
      on-event="/interface wireguard print where name=NugaCoreWG; :log info \\"NugaCore WG peer status checked\\""
}`;

  return { section, warnings };
};

const sectionSstp = (
  p: ResourceGeneratorParams,
  vpnUser: string,
  vpnPassword: string,
): { section: string; warnings: string[] } => {
  const warnings: string[] = [];
  const host = (p.sstpHost || '').trim();
  const managementCidr = (p.sstpManagementCidr || '').trim() || '10.70.0.0/16';

  if (!host) {
    warnings.push('sstpHost faltante: no se emite cliente SSTP (evita fallo en /import).');
    const section = `
# --- 15. SSTP (INCOMPLETO — sin connect-to) ---
:if ([:len [/ppp profile find name="nugacore-profile"]] = 0) do={
  /ppp profile add name="nugacore-profile" comment="NugaCore VPN profile"
}
:log warning "NugaCore SSTP incompleto: regenerar con sstpHost real"`;
    return { section, warnings };
  }

  const section = `
# --- 15. SSTP ---
:if ([:len [/ppp profile find name="nugacore-profile"]] = 0) do={
  /ppp profile add name="nugacore-profile" comment="NugaCore VPN profile"
}
:if ([:len [/interface sstp-client find name="NugaCoreVPN"]] = 0) do={
  /interface sstp-client add name="NugaCoreVPN" \\
      connect-to="${host}" \\
      user="${vpnUser}" \\
      password="${vpnPassword}" \\
      profile="nugacore-profile" \\
      add-default-route=no \\
      disabled=no \\
      comment="NugaCore VPN"
}
:if ([:len [/ip route find dst-address="${managementCidr}" comment~"NugaCore"]] = 0) do={
  /ip route add dst-address="${managementCidr}" gateway=NugaCoreVPN comment="NugaCore management route"
}

# --- 16. Watchdog SSTP ---
:if ([:len [/system scheduler find name="NugaCore-VPN-Watchdog"]] = 0) do={
  /system scheduler add name="NugaCore-VPN-Watchdog" interval=00:01:00 \\
      comment="NugaCore VPN watchdog" \\
      on-event="/interface sstp-client enable [find where name=\\"NugaCoreVPN\\" disabled=yes]"
}`;

  return { section, warnings };
};

const sectionLabDirect = (p: ResourceGeneratorParams, allowedCidr: string): string => `
# --- 15. Acceso directo (modo laboratorio) ---
# La API queda accesible desde la red LAN. Solo para laboratorio — no usar en produccion.
# allowedCidr: ${allowedCidr}`;

const sectionSystemNote = (p: ResourceGeneratorParams, templateLabel: string): string => `
# --- 17. System note ---
/system note set note="NugaCore WISP Router\\n${p.routerName}\\nPlantilla: ${templateLabel}\\nGenerado: ${new Date().toISOString().slice(0, 10)}"`;

const sectionFileCleanup = (): string => `
# --- 18. Limpieza del archivo .rsc (si se importo desde el almacenamiento del router) ---
:delay 2
/file remove [find name~"^(nc-|nugacore-)"]
:log info "NugaCore: configuracion aplicada correctamente."`;

// ── Punto de entrada ──────────────────────────────────────────────────

export const generateResource = (p: ResourceGeneratorParams): GeneratedResource => {
  const templateLabels: Record<string, string> = {
    base_wisp_wireguard: 'Router Base WISP + WireGuard NugaCore',
    base_wisp_sstp: 'Router Base WISP + SSTP NugaCore',
    lab_direct: 'Laboratorio - Acceso Directo',
  };
  const templateLabel = templateLabels[p.templateId] || p.templateId;

  const warnings: string[] = [];

  // Credenciales API (password en claro solo para incrustar en el script).
  const apiCred = generateApiCredential(p.routerName);
  // Credenciales VPN (solo SSTP las necesita).
  const vpnCred = generateApiCredential(`vpn_${p.routerName}`);

  // CIDR permitido para la API.
  let allowedApiCidr: string;
  if (p.templateId === 'base_wisp_wireguard') {
    allowedApiCidr = p.wgVpnCidr || p.wgManagementCidr || '10.10.0.0/24';
  } else if (p.templateId === 'base_wisp_sstp') {
    allowedApiCidr = p.sstpVpnCidr || p.sstpManagementCidr || '10.10.0.0/24';
  } else {
    allowedApiCidr = p.lanCidr;
  }

  // Construcción del script.
  let vpnSection: string;
  if (p.templateId === 'base_wisp_wireguard') {
    const { section, warnings: wgWarnings } = sectionWireguard(p);
    vpnSection = section;
    warnings.push(...wgWarnings);
  } else if (p.templateId === 'base_wisp_sstp') {
    const { section, warnings: sstpWarnings } = sectionSstp(p, vpnCred.username, vpnCred.plainPassword);
    vpnSection = section;
    warnings.push(...sstpWarnings);
  } else {
    vpnSection = sectionLabDirect(p, allowedApiCidr);
  }

  const script = [
    scriptHeader(p, templateLabel),
    sectionCleanup(p),
    sectionIdentity(p),
    sectionBridge(p),
    sectionInterfaceLists(p),
    sectionIpLan(p),
    sectionDhcp(p),
    sectionDns(p),
    sectionNat(p),
    sectionFirewall(p),
    sectionUserAndGroup(apiCred.username, apiCred.plainPassword),
    sectionApiService(p, allowedApiCidr),
    vpnSection,
    sectionSystemNote(p, templateLabel),
    sectionFileCleanup(),
  ].join('\n');

  // Verificaciones de seguridad — lanzan si falla.
  assertNoBrandViolation(script);
  assertNoForbiddenPolicies(script);

  const scriptHash = sha256Hex(script);
  const filename = buildFilename(p.routerName, p.templateId);
  const generatedAt = new Date().toISOString();

  return {
    script,
    scriptHash,
    filename,
    templateId: p.templateId,
    generatorVersion: RESOURCE_GENERATOR_VERSION,
    warnings,
    generatedAt,
    apiUsername: apiCred.username,
  };
};
