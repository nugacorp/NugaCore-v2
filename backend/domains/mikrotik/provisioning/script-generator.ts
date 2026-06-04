// ====================================================================
// Generador de script RouterOS para provisioning NugaCore (Fase 4.4).
//
// Produce un script que el operador copia y pega en RouterOS para:
//   1. crear grupo NugaCore con permisos MÍNIMOS
//   2. crear usuario API NugaCore
//   3. habilitar API solo desde la red VPN/management
//   4. crear el cliente VPN (WireGuard | SSTP)
//   5. agregar rutas hacia la red de administración de NugaCore
//   6. agregar scheduler de reconexión
//   7. comentarios claros
//   8. ser IDEMPOTENTE (remove/find de config NugaCore previa, recrea)
//
// Prefijos: NugaCore / nugacore / NUGACORE. Nunca "wisphub".
// Permisos mínimos: read,write,api,test (sin sniff/sensitive/romon/reboot/password/policy).
// ====================================================================

import { sha256Hex } from './credentials';
import {
  SCRIPT_VERSION,
  ScriptGenerationInput,
  ScriptGenerationResult,
} from './types';

// Política mínima del grupo NugaCore. Mantener corto y justificado:
//   read  → leer interfaces/queues/ppp
//   write → alta/suspensión/reactivación/velocidad de clientes
//   api   → acceso vía API
//   test  → ping/bandwidth-test de diagnóstico
export const NUGACORE_GROUP_POLICY = 'read,write,api,test';

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

const header = (routerName: string, kind: string): string =>
  `# ============================================================
# NugaCore — Provisioning Script (${kind})  ${SCRIPT_VERSION}
# Router: ${routerName}
# Genera: VPN ${kind} + usuario API con permisos MINIMOS (${NUGACORE_GROUP_POLICY})
# Idempotente: elimina la configuracion NugaCore previa y la recrea.
# La API queda limitada a la red VPN de NugaCore.
# ============================================================`;

const commonCleanup = (): string =>
  `# --- 1. Limpieza idempotente de configuracion NugaCore previa ---
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/ip route remove [find where comment~"NugaCore"]
/ip address remove [find where comment~"NugaCore"]`;

const commonUserAndGroup = (apiUser: string, apiPassword: string): string =>
  `# --- 2. Grupo con permisos minimos ---
/user group add name=nugacore policy="${NUGACORE_GROUP_POLICY}" comment="NugaCore minimal API group"

# --- 3. Usuario API NugaCore ---
/user add name="${apiUser}" password="${apiPassword}" group=nugacore comment="NugaCore API user"`;

// ── SSTP ──────────────────────────────────────────────────────────────
const buildSstpScript = (input: ScriptGenerationInput): { script: string; warnings: string[] } => {
  const { routerName, apiUser, apiPassword, apiPort, vpnUser, vpnPassword, server } = input;
  const warnings: string[] = [];
  requireField(server.vpnHost, 'server.vpnHost');
  requireField(server.vpnCidr, 'server.vpnCidr');
  requireField(server.serverManagementCidr, 'server.serverManagementCidr');

  const script = `${header(routerName, 'SSTP')}

${commonCleanup()}
/interface sstp-client remove [find where name~"NugaCore"]
/ppp profile remove [find where name~"nugacore"]

${commonUserAndGroup(apiUser, apiPassword)}

# --- 4. Perfil PPP NugaCore ---
/ppp profile add name=nugacore-profile comment="NugaCore VPN profile"

# --- 5. Cliente SSTP hacia el concentrador NugaCore ---
/interface sstp-client add name="NugaCoreVPN" connect-to="${server.vpnHost}" user="${vpnUser}" password="${vpnPassword}" profile="nugacore-profile" comment="NugaCore VPN" add-default-route=no disabled=no

# --- 6. Ruta hacia la red de administracion NugaCore ---
/ip route add dst-address="${server.serverManagementCidr}" gateway=NugaCoreVPN comment="NugaCore management route"

# --- 7. API limitada a la red VPN de NugaCore ---
/ip service set api port=${apiPort} address="${server.vpnCidr}" disabled=no
/ip service set api-ssl address="${server.vpnCidr}"

# --- 8. Scheduler de reconexion VPN ---
/system scheduler add name=NugaCore-VPN-Watchdog interval=00:01:00 comment="NugaCore VPN reconnect watchdog" on-event="/interface sstp-client enable [find where name=\\"NugaCoreVPN\\" disabled=yes]"

# ============================================================
# Fin del script NugaCore (SSTP). La API solo responde dentro de ${server.vpnCidr}.
# ============================================================`;

  return { script, warnings };
};

// ── WireGuard (RouterOS v7) ───────────────────────────────────────────
const buildWireguardScript = (input: ScriptGenerationInput): { script: string; warnings: string[] } => {
  const { routerName, apiUser, apiPassword, apiPort, server } = input;
  const warnings: string[] = [];
  requireField(server.vpnCidr, 'server.vpnCidr');
  requireField(server.serverManagementCidr, 'server.serverManagementCidr');

  const wgServerPublicKey = server.wgServerPublicKey || '<PEGAR_PUBLIC_KEY_DEL_SERVIDOR_NUGACORE>';
  const wgInterfaceAddress = server.wgInterfaceAddress || '<ASIGNAR_IP_WG_DEL_ROUTER>/32';
  const wgAllowedAddress = server.wgAllowedAddress || server.serverManagementCidr;
  const keepalive = server.wgKeepalive ?? 25;

  if (!server.wgServerPublicKey) warnings.push('Falta wgServerPublicKey: se dejó un placeholder en el script.');
  if (!server.wgEndpoint) warnings.push('Falta wgEndpoint (host:port): se dejó un placeholder en el script.');
  if (!server.wgInterfaceAddress) warnings.push('Falta wgInterfaceAddress: asignar la IP WG del router.');

  let endpointHost = '<ENDPOINT_HOST>';
  let endpointPort = '13231';
  if (server.wgEndpoint && server.wgEndpoint.includes(':')) {
    const [h, p] = server.wgEndpoint.split(':');
    endpointHost = h;
    endpointPort = p || endpointPort;
  } else if (server.wgEndpoint) {
    endpointHost = server.wgEndpoint;
  }

  const script = `${header(routerName, 'WireGuard')}
# NOTA: WireGuard requiere RouterOS v7. Intercambio de claves (paso manual):
#   1. NugaCore genera el peer del servidor (public key + endpoint).
#   2. El router genera su private-key automaticamente al crear la interfaz.
#   3. Ejecuta  [/interface wireguard print]  y copia la public-key del router.
#   4. Registra esa public-key del router en NugaCore para completar el tunel.

${commonCleanup()}
/interface wireguard peers remove [find where comment~"NugaCore"]
/interface wireguard remove [find where name~"NugaCore"]

${commonUserAndGroup(apiUser, apiPassword)}

# --- 4. Interfaz WireGuard (RouterOS genera la private-key) ---
/interface wireguard add name=NugaCoreWG listen-port=13231 comment="NugaCore WireGuard"

# --- 5. Direccion IP del router sobre la interfaz WG ---
/ip address add address=${wgInterfaceAddress} interface=NugaCoreWG comment="NugaCore WG address"

# --- 6. Peer del servidor WireGuard de NugaCore ---
/interface wireguard peers add interface=NugaCoreWG public-key="${wgServerPublicKey}" endpoint-address=${endpointHost} endpoint-port=${endpointPort} allowed-address=${wgAllowedAddress} persistent-keepalive=${keepalive}s comment="NugaCore WG server peer"

# --- 7. Ruta hacia la red de administracion NugaCore ---
/ip route add dst-address="${server.serverManagementCidr}" gateway=NugaCoreWG comment="NugaCore management route"

# --- 8. API limitada a la red VPN de NugaCore ---
/ip service set api port=${apiPort} address="${server.vpnCidr}" disabled=no
/ip service set api-ssl address="${server.vpnCidr}"

# --- 9. Scheduler watchdog (imprime la public-key para registrarla) ---
/system scheduler add name=NugaCore-WG-Watchdog interval=00:05:00 comment="NugaCore WG watchdog" on-event="/interface wireguard print where name=NugaCoreWG"

# ============================================================
# Fin del script NugaCore (WireGuard). La API solo responde dentro de ${server.vpnCidr}.
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

  const { script, warnings } =
    input.connectionType === 'wireguard'
      ? buildWireguardScript(input)
      : buildSstpScript(input);

  return {
    script,
    scriptHash: sha256Hex(script),
    scriptVersion: SCRIPT_VERSION,
    connectionType: input.connectionType,
    warnings,
  };
};
