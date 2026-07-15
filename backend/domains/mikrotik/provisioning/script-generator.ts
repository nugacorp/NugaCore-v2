// ====================================================================
// Generador de script RouterOS para provisioning NugaCore.
//
// Modos (Fase 4.6.0):
//   wireguard_managed = PRINCIPAL (recomendado, RouterOS v7)
//   sstp_managed      = FALLBACK (v6/v7, NAT/CGNAT difícil)
//   tailscale_lab / direct_lab = LABORATORIO/soporte (sin VPN propia)
//
// En todos los modos: usuario API NugaCore con permisos MÍNIMOS, API limitada
// a la red VPN/lab (nunca expuesta a internet), idempotente, prefijo NugaCore.
// Nunca "wisphub". Sin sniff/sensitive/romon/reboot/password/policy/ftp.
// ====================================================================

import { sha256Hex } from './credentials';
import {
  ApiMode,
  ProvisioningMode,
  SCRIPT_VERSION,
  ScriptGenerationInput,
  ScriptGenerationResult,
  ScriptServerConfig,
  isLabMode,
  normalizeProvisioningMode,
} from './types';

// Política del grupo según el modo de API.
//   operator  → read,write,api,test (alta/suspensión/reactivación/velocidad)
//   read_only → read,api,test       (solo lectura + diagnóstico)
export const NUGACORE_GROUP_POLICY = 'read,write,api,test';
export const NUGACORE_READONLY_POLICY = 'read,api,test';

export const policyForApiMode = (apiMode: ApiMode): string =>
  apiMode === 'read_only' ? NUGACORE_READONLY_POLICY : NUGACORE_GROUP_POLICY;

// Políticas explícitamente PROHIBIDAS (no deben aparecer en el grupo).
export const FORBIDDEN_POLICIES = ['sniff', 'sensitive', 'romon', 'reboot', 'password', 'policy', 'ftp'];

const requireField = (value: string | number | undefined, name: string): void => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`script-generator: missing required field "${name}"`);
  }
};

/** Enmascara un secreto para summaries/logs (nunca el valor real). */
export const maskSecret = (value: string): string => {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.substring(0, 2)}****${value.substring(value.length - 2)}`;
};

// Resolución de campos (preferir modelo administrado nuevo, fallback al legacy).
const apiCidrOf = (s: ScriptServerConfig): string => s.allowedApiCidr || s.vpnNetworkCidr || s.vpnCidr;
const vpnCidrOf = (s: ScriptServerConfig): string => s.vpnNetworkCidr || s.vpnCidr;
const vpnHostOf = (s: ScriptServerConfig): string => s.vpnServerHost || s.vpnHost;

const header = (routerName: string, kind: string, apiMode: ApiMode): string =>
  `# ============================================================
# NugaCore — Provisioning Script (${kind})  ${SCRIPT_VERSION}
# Router: ${routerName}
# API user: permisos ${apiMode} (${policyForApiMode(apiMode)})
# Idempotente: elimina la configuracion NugaCore previa y la recrea.
# La API queda limitada a la red VPN/lab de NugaCore (no expuesta a internet).
# ============================================================`;

const commonCleanup = (): string =>
  `# --- 1. Limpieza idempotente de configuracion NugaCore previa ---
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/ip route remove [find where comment~"NugaCore"]
/ip address remove [find where comment~"NugaCore"]
/system scheduler remove [find where comment~"NugaCore"]`;

const userAndGroup = (apiUser: string, apiPassword: string, apiMode: ApiMode, tag: string): string =>
  `# --- 2. Grupo con permisos minimos (${apiMode}) ---
/user group add name=nugacore policy="${policyForApiMode(apiMode)}" comment="NugaCore ${tag} group"

# --- 3. Usuario API NugaCore ---
/user add name="${apiUser}" password="${apiPassword}" group=nugacore comment="NugaCore API user (${tag})"`;

/**
 * Script mínimo para alinear el usuario API del CHR con las credenciales
 * ya persistidas en NugaCore. No toca WireGuard ni la LAN (túnel intacto).
 */
export const buildApiRepairScript = (input: {
  routerName: string;
  apiUser: string;
  apiPassword: string;
  apiPort?: number;
  allowedApiCidr?: string;
  apiMode?: ApiMode;
}): { script: string; filename: string } => {
  const apiMode: ApiMode = input.apiMode ?? 'operator';
  const apiPort = input.apiPort || 8728;
  const apiCidr = (input.allowedApiCidr || '10.70.0.0/16').trim();
  const apiUser = input.apiUser.trim();
  const apiPassword = input.apiPassword.trim();
  requireField(apiUser, 'apiUser');
  requireField(apiPassword, 'apiPassword');

  const script = `# NugaCore
# ============================================================
# NugaCore — Reparar API (sin tocar WireGuard)  ${SCRIPT_VERSION}
# Router: ${input.routerName}
# ============================================================
# Importar en el CHR cuando el túnel WG responde (ping 10.70.0.1)
# pero la web sigue offline por usuario/password API desfasados:
#   /import file-name=nc-api.rsc
# Luego en NugaCore: Sistema → Routers → Verificar.

# Limpia SOLO usuario/grupo API NugaCore (no peer WG)
/user remove [find where name~"nugacore_"]
/user group remove [find where name="nugacore"]

${userAndGroup(apiUser, apiPassword, apiMode, 'API repair')}

# API solo desde red VPN NugaCore
/ip service set [find where name="api" and dynamic=no] port=${apiPort} address=${apiCidr} disabled=no
/ip service set [find where name="api-ssl" and dynamic=no] disabled=yes
`;

  return { script, filename: 'nc-api.rsc' };
};

// ── WireGuard administrado ────────────────────────────────────────────
const buildWireguardScript = (input: ScriptGenerationInput, apiMode: ApiMode): { script: string; warnings: string[]; routerVpnIp: string } => {
  const { routerName, apiUser, apiPassword, apiPort, server } = input;
  const warnings: string[] = [];
  requireField(vpnCidrOf(server), 'server.vpnNetworkCidr');
  requireField(server.serverManagementCidr, 'server.serverManagementCidr');

  const apiCidr = apiCidrOf(server);
  const wgServerPublicKey = (server.wgServerPublicKey || '').trim();
  const routerVpnIpRaw = (server.routerVpnIp || server.wgInterfaceAddress || '').trim();
  const routerVpnIp = routerVpnIpRaw
    ? (routerVpnIpRaw.includes('/') ? routerVpnIpRaw : `${routerVpnIpRaw}/32`)
    : '';
  const wgAllowedAddress = server.wgAllowedAddress || server.serverManagementCidr;
  const keepalive = server.wgKeepalive ?? 25;

  // Endpoint del servidor: preferir vpnServerHost/Port; fallback wgEndpoint.
  let endpointHost = (server.vpnServerHost || '').trim();
  let endpointPort = String(server.vpnServerPort || '13231');
  if (!endpointHost && server.wgEndpoint) {
    if (server.wgEndpoint.includes(':')) {
      const idx = server.wgEndpoint.lastIndexOf(':');
      endpointHost = server.wgEndpoint.slice(0, idx);
      endpointPort = server.wgEndpoint.slice(idx + 1) || endpointPort;
    } else {
      endpointHost = server.wgEndpoint;
    }
  }

  const wgComplete = Boolean(wgServerPublicKey && endpointHost && routerVpnIp);
  if (!wgServerPublicKey) warnings.push('Falta wgServerPublicKey: se omite peer (evita fallo en /import).');
  if (!routerVpnIp) warnings.push('Falta routerVpnIp: se omite address WG (evita fallo en /import).');
  if (!endpointHost) warnings.push('Falta vpnServerHost/wgEndpoint: se omite peer (evita fallo en /import).');
  if (!wgComplete) {
    warnings.push('WireGuard incompleto: solo se crea la interfaz NugaCoreWG. Completa claves/endpoint/IP y regenera.');
  }

  // Si el WireGuard Manager proveyó la private-key del router, la fijamos en la
  // interfaz (sin intercambio manual). Si no, RouterOS la autogenera.
  const managed = !!server.wgRouterPrivateKey;
  // private-key en SET top-level (evita "invalid private key" al pegar dentro de do={}).
  const interfaceLine = `/interface wireguard add name=NugaCoreWG listen-port=13231 comment="NugaCore WireGuard"`;
  const privateKeySet = managed
    ? `/interface wireguard set [find name=NugaCoreWG] private-key="${server.wgRouterPrivateKey}"`
    : '';
  const presharedPart = server.wgPresharedKey ? ` preshared-key="${server.wgPresharedKey}"` : '';
  const keyNote = managed
    ? `# Claves administradas por NugaCore (WireGuard Manager): private-key y
# preshared-key incrustadas. El servidor ya registró la public-key del peer.`
    : `# NOTA: intercambio de claves manual:
#   1. El router genera su private-key automaticamente al crear la interfaz.
#   2. Ejecuta  [/interface wireguard print]  y copia la public-key del router.
#   3. Registra esa public-key del router en NugaCore para completar el tunel.`;

  const wgTunnelBlock = wgComplete
    ? `# --- 5. Direccion IP del router sobre la interfaz WG ---
/ip address add address=${routerVpnIp} interface=NugaCoreWG comment="NugaCore WG address"

# --- 6. Peer del servidor WireGuard de NugaCore ---
/interface wireguard peers add interface=NugaCoreWG public-key="${wgServerPublicKey}"${presharedPart} endpoint-address="${endpointHost}" endpoint-port=${endpointPort} allowed-address=${wgAllowedAddress} persistent-keepalive=${keepalive}s comment="NugaCore WG server peer"

# --- 7. Ruta hacia la red de administracion NugaCore ---
/ip route add dst-address="${server.serverManagementCidr}" gateway=NugaCoreWG comment="NugaCore management route"`
    : `# --- 5-7. WG incompleto: NO se emiten address/peer/route (placeholders abortaban /import) ---
:log warning "NugaCore WG incompleto: regenerar con public-key, endpoint e IP peer reales"`;

  const script = `${header(routerName, 'WireGuard administrado', apiMode)}
# WireGuard requiere RouterOS v7.
${keyNote}

${commonCleanup()}
/interface wireguard peers remove [find where comment~"NugaCore"]
/interface wireguard remove [find where name~"NugaCore"]

${userAndGroup(apiUser, apiPassword, apiMode, 'WireGuard')}

# --- 4. Interfaz WireGuard ---
${interfaceLine}
${privateKeySet}

${wgTunnelBlock}

# --- 8. API limitada a la red VPN de NugaCore ---
# find !dynamic: ROS 7.19+ rechaza set api cuando hay sesiones dinámicas.
/ip service set [find where name="api" and dynamic=no] port=${apiPort} address=${apiCidr} disabled=no
/ip service set [find where name="api-ssl" and dynamic=no] address=${apiCidr}

# --- 9. Scheduler watchdog (imprime la public-key para registrarla) ---
/system scheduler add name=NugaCore-WG-Watchdog interval=00:05:00 comment="NugaCore WG watchdog" on-event="/interface wireguard print where name=NugaCoreWG"

# ============================================================
# Fin del script NugaCore (WireGuard). La API solo responde dentro de ${apiCidr}.
# ============================================================`;

  return { script, warnings, routerVpnIp: routerVpnIp || 'pending' };
};

// ── SSTP administrado ─────────────────────────────────────────────────
const buildSstpScript = (input: ScriptGenerationInput, apiMode: ApiMode): { script: string; warnings: string[]; routerVpnIp: string } => {
  const { routerName, apiUser, apiPassword, apiPort, vpnUser, vpnPassword, server } = input;
  const warnings: string[] = [];
  requireField(vpnHostOf(server), 'server.vpnServerHost');
  requireField(vpnCidrOf(server), 'server.vpnNetworkCidr');
  requireField(server.serverManagementCidr, 'server.serverManagementCidr');

  const apiCidr = apiCidrOf(server);
  const vpnHost = vpnHostOf(server);
  const routerVpnIp = server.routerVpnIp || '';

  const script = `${header(routerName, 'SSTP administrado', apiMode)}

${commonCleanup()}
/interface sstp-client remove [find where name~"NugaCore"]
/ppp profile remove [find where name~"nugacore"]

${userAndGroup(apiUser, apiPassword, apiMode, 'SSTP')}

# --- 4. Perfil PPP NugaCore ---
/ppp profile add name=nugacore-profile comment="NugaCore VPN profile"

# --- 5. Cliente SSTP hacia el concentrador NugaCore ---
/interface sstp-client add name="NugaCoreVPN" connect-to="${vpnHost}" user="${vpnUser}" password="${vpnPassword}" profile="nugacore-profile" comment="NugaCore VPN" add-default-route=no disabled=no

# --- 6. Ruta hacia la red de administracion NugaCore ---
/ip route add dst-address="${server.serverManagementCidr}" gateway=NugaCoreVPN comment="NugaCore management route"

# --- 7. API limitada a la red VPN de NugaCore ---
/ip service set [find where name="api" and dynamic=no] port=${apiPort} address=${apiCidr} disabled=no
/ip service set [find where name="api-ssl" and dynamic=no] address=${apiCidr}

# --- 8. Scheduler de reconexion VPN ---
/system scheduler add name=NugaCore-VPN-Watchdog interval=00:01:00 comment="NugaCore VPN reconnect watchdog" on-event="/interface sstp-client enable [find where name=\\"NugaCoreVPN\\" disabled=yes]"

# ============================================================
# Fin del script NugaCore (SSTP). La API solo responde dentro de ${apiCidr}.
# ============================================================`;

  return { script, warnings, routerVpnIp };
};

// ── Laboratorio (tailscale / direct) ──────────────────────────────────
const buildLabScript = (input: ScriptGenerationInput, mode: ProvisioningMode, apiMode: ApiMode): { script: string; warnings: string[] } => {
  const { routerName, apiUser, apiPassword, apiPort, server } = input;
  const warnings: string[] = [];

  const labCidr =
    mode === 'tailscale_lab'
      ? (server.allowedApiCidr || '100.64.0.0/10')
      : (server.allowedApiCidr || server.serverManagementCidr || vpnCidrOf(server) || '');

  if (!labCidr) {
    requireField(labCidr, 'server.allowedApiCidr');
  }
  warnings.push('Modo LABORATORIO/soporte: no crea VPN ni rutas. No recomendado como arquitectura principal.');
  if (mode === 'tailscale_lab') warnings.push('Tailscale: NugaCore no administra el túnel. API limitada al CIDR de Tailscale.');

  const kind = mode === 'tailscale_lab' ? 'Tailscale LAB' : 'Direct LAB';
  const script = `${header(routerName, kind, apiMode)}
# AVISO: Modo LABORATORIO/soporte. NO crea VPN propia, NO agrega rutas, NO
# cambia la red. Solo crea un usuario API restringido. No usar como
# arquitectura principal para clientes externos (usar WireGuard administrado).

# --- 1. Limpieza idempotente de configuracion NugaCore previa ---
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]

${userAndGroup(apiUser, apiPassword, apiMode, kind)}

# --- 4. API limitada al CIDR de laboratorio (sin VPN, sin rutas) ---
/ip service set api port=${apiPort} address="${labCidr}" disabled=no
/ip service set api-ssl address="${labCidr}"

# ============================================================
# Fin del script NugaCore (${kind}). La API solo responde dentro de ${labCidr}.
# ============================================================`;

  return { script, warnings };
};

/** Punto de entrada: genera el script y su metadata (hash sin secretos). */
export const generateProvisioningScript = (
  input: ScriptGenerationInput,
): ScriptGenerationResult => {
  requireField(input.routerName, 'routerName');
  requireField(input.apiUser, 'apiUser');
  requireField(input.apiPassword, 'apiPassword');
  requireField(input.apiPort, 'apiPort');

  const mode = normalizeProvisioningMode(String(input.connectionType));
  const apiMode: ApiMode = input.apiMode ?? (isLabMode(mode) ? 'read_only' : 'operator');

  let built: { script: string; warnings: string[]; routerVpnIp?: string };
  if (mode === 'wireguard_managed') built = buildWireguardScript(input, apiMode);
  else if (mode === 'sstp_managed') built = buildSstpScript(input, apiMode);
  else built = buildLabScript(input, mode, apiMode);

  return {
    script: built.script,
    scriptHash: sha256Hex(built.script),
    scriptVersion: SCRIPT_VERSION,
    connectionType: String(input.connectionType),
    mode,
    apiMode,
    routerVpnIp: built.routerVpnIp || undefined,
    warnings: built.warnings,
  };
};
