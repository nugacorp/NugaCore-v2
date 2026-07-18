// ====================================================================
// Generador de script de arranque de OLT + snippet MikroTik de alcanzabilidad.
//
// Produce (a) un script CLI de PRIMERA configuración para la OLT según su familia
// de CLI, que crea un usuario SSH y deja la gestión segura; y (b) un snippet .rsc
// para el MikroTik (peer WireGuard de la torre) que hace la OLT alcanzable desde
// el WireGuard server de la app: WG server → MikroTik → LAN → OLT.
//
// SEGURIDAD:
//   - El password SSH se GENERA y se devuelve UNA sola vez; NO se persiste.
//   - Los scripts son PLANTILLAS de arranque: revisar contra el manual del equipo
//     antes de aplicar. No se ejecuta nada desde aquí.
// ====================================================================

import { randomBytes } from 'crypto';
import type {
  OltConfigRecommendation,
  OltDevice,
  OltReachability,
  OltScriptResult,
} from './types';

const DEFAULT_SSH_USER = 'nugacore-noc';

// Password fuerte legible (sin caracteres ambiguos), no persistido.
const generatePassword = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${out}!7`;
};

const header = (device: OltDevice, rec: OltConfigRecommendation): string =>
  [
    `! ==============================================================`,
    `! NugaCore — arranque OLT ${device.brand} ${device.model} (${rec.ponType.toUpperCase()})`,
    `! ${rec.summary}`,
    `! REVISAR antes de aplicar. No ejecutar a ciegas.`,
    `! Gestión: ${device.managementIp}${device.managementVlan ? ` (VLAN ${device.managementVlan})` : ''} · SSH puerto ${device.sshPort}`,
    `! ==============================================================`,
  ].join('\n');

type FlavorFn = (d: OltDevice, r: OltConfigRecommendation, user: string, pass: string) => string;

const huawei: FlavorFn = (d, r, user, pass) =>
  [
    header(d, r),
    `enable`,
    `config`,
    `sysname ${d.name.replace(/\s+/g, '-')}`,
    `! --- Gestión (VLAN dedicada + IP) ---`,
    d.managementVlan ? `vlan ${d.managementVlan} smart` : `! (sin VLAN de gestión definida)`,
    `interface meth0`,
    ` ip address ${d.managementIp} 255.255.255.0`,
    ` quit`,
    `! --- Usuario SSH (gestión cifrada) ---`,
    `aaa`,
    ` local-user ${user} password irreversible-cipher ${pass} `,
    ` local-user ${user} level 3`,
    ` quit`,
    `ssh user ${user} authentication-type password`,
    `ssh user ${user} service-type stelnet`,
    `stelnet server enable`,
    `undo telnet server enable`,
    `! --- ONU: autenticación por serie + perfil DBA estable ---`,
    `dba-profile add profile-id 10 type3 assure 51200 max 1024000`,
    `! --- NTP / syslog ---`,
    `ntp-service unicast-server 200.23.51.102`,
    `save`,
  ].join('\n');

const zte: FlavorFn = (d, r, user, pass) =>
  [
    header(d, r),
    `enable`,
    `configure terminal`,
    `hostname ${d.name.replace(/\s+/g, '-')}`,
    d.managementVlan ? `vlan ${d.managementVlan}` : `! (sin VLAN de gestión definida)`,
    `interface vlan ${d.managementVlan ?? 1}`,
    ` ip address ${d.managementIp} 255.255.255.0`,
    ` exit`,
    `! --- Usuario SSH ---`,
    `username ${user} password ${pass}`,
    `ssh server enable`,
    `no telnet server enable`,
    `! --- DBA estable (perfil garantizado + máximo) ---`,
    `gpon`,
    ` profile tcont dba-nuga type 3 assured 51200 maximum 1024000`,
    ` exit`,
    `ntp server 200.23.51.102`,
    `write`,
  ].join('\n');

const vsolBdcom: FlavorFn = (d, r, user, pass) =>
  [
    header(d, r),
    `enable`,
    `config`,
    `hostname ${d.name.replace(/\s+/g, '-')}`,
    `interface vlan ${d.managementVlan ?? 1}`,
    ` ip address ${d.managementIp} 255.255.255.0`,
    ` exit`,
    `username ${user} privilege 15 password ${pass}`,
    `service ssh-server enable`,
    `no service telnet-server`,
    `ntp server 200.23.51.102`,
    `write`,
  ].join('\n');

const cdata: FlavorFn = (d, r, user, pass) =>
  [
    header(d, r),
    `enable`,
    `configure terminal`,
    `hostname ${d.name.replace(/\s+/g, '-')}`,
    `interface vlanif ${d.managementVlan ?? 1}`,
    ` ip address ${d.managementIp} 255.255.255.0`,
    ` exit`,
    `aaa local user ${user} password ${pass} level administrator`,
    `ssh server enable`,
    `telnet server disable`,
    `ntp server ip 200.23.51.102`,
    `save`,
  ].join('\n');

const fiberhome: FlavorFn = (d, r, user, pass) =>
  [
    header(d, r),
    `enable`,
    `config`,
    `hostname ${d.name.replace(/\s+/g, '-')}`,
    `interface meth ${d.managementVlan ?? 1}`,
    ` ip address ${d.managementIp} 255.255.255.0`,
    ` quit`,
    `user add ${user} password ${pass} privilege administrator`,
    `sshd enable`,
    `telnetd disable`,
    `ntp server 200.23.51.102`,
    `save`,
  ].join('\n');

const generic: FlavorFn = (d, r, user, pass) =>
  [
    header(d, r),
    `! Familia de CLI no catalogada — adaptar a la sintaxis exacta del equipo.`,
    `! 1) Hostname: ${d.name}`,
    `! 2) IP de gestión: ${d.managementIp}/24${d.managementVlan ? ` en VLAN ${d.managementVlan}` : ''}`,
    `! 3) Crear usuario administrador SSH: ${user} / ${pass}`,
    `! 4) Habilitar SSH y DESHABILITAR telnet.`,
    `! 5) DBA garantizado+máximo; ONU auth por serie; split ${r.capacity.recommendedSplit}.`,
    `! 6) NTP + syslog remoto al NOC.`,
    `! 7) Guardar configuración.`,
  ].join('\n');

const FLAVORS: Record<OltConfigRecommendation['cliFlavor'], FlavorFn> = {
  huawei,
  zte,
  'vsol-bdcom': vsolBdcom,
  cdata,
  fiberhome,
  generic,
};

// Snippet .rsc para el MikroTik peer: permite y NATea WG → OLT, de modo que el
// WireGuard server (app) alcance la IP de gestión de la OLT en la LAN.
const buildMikrotikSnippet = (
  device: OltDevice,
  reach: OltReachability,
): { snippet: string; warnings: string[] } => {
  const warnings: string[] = [];
  const wgIf = reach.mikrotikWgInterface || '<INTERFAZ_WG>';
  const lanIf = reach.mikrotikLanInterface || '<INTERFAZ_LAN>';
  if (!reach.mikrotikWgInterface) warnings.push('Falta la interfaz WireGuard del MikroTik (mikrotikWgInterface).');
  if (!reach.mikrotikLanInterface) warnings.push('Falta la interfaz LAN del MikroTik hacia la OLT (mikrotikLanInterface).');
  if (!reach.mikrotikLanIp) warnings.push('La OLT debe usar como gateway la IP LAN del MikroTik para el retorno.');

  const snippet = [
    `# NugaCore — alcanzar OLT ${device.name} (${device.managementIp}) por WireGuard`,
    `# Flujo: WG server (app) -> MikroTik (${wgIf}) -> LAN (${lanIf}) -> OLT`,
    `/ip firewall filter`,
    `add chain=forward action=accept in-interface=${wgIf} dst-address=${device.managementIp} \\`,
    `  comment="NugaCore: WG->OLT ${device.name}" place-before=0`,
    `/ip firewall nat`,
    `# Masquerade: la OLT ve al MikroTik como origen y responde a su gateway,`,
    `# así funciona aunque la OLT no tenga ruta a la subred WireGuard.`,
    `add chain=srcnat action=masquerade out-interface=${lanIf} dst-address=${device.managementIp} \\`,
    `  comment="NugaCore: srcnat WG->OLT ${device.name}"`,
    reach.mikrotikLanIp
      ? `# Gateway de la OLT: ${reach.mikrotikLanIp} (IP LAN del MikroTik).`
      : `# Configurar en la OLT gateway = IP LAN del MikroTik.`,
  ].join('\n');

  return { snippet, warnings };
};

export interface GenerateScriptInput {
  device: OltDevice;
  recommendation: OltConfigRecommendation;
  reachability?: OltReachability;
}

export const generateOltScript = (input: GenerateScriptInput): OltScriptResult => {
  const { device, recommendation } = input;
  const user = device.sshUsername?.trim() || DEFAULT_SSH_USER;
  const pass = generatePassword();
  const flavorFn = FLAVORS[recommendation.cliFlavor] ?? generic;
  const oltScript = flavorFn(device, recommendation, user, pass);

  const { snippet, warnings } = buildMikrotikSnippet(device, input.reachability ?? {});

  const allWarnings = [
    'Plantilla de arranque: revisar contra el manual del equipo antes de aplicar.',
    'El password SSH se muestra una sola vez y no se guarda. Guárdalo ahora.',
    ...warnings,
  ];

  return {
    oltScript,
    mikrotikSnippet: snippet,
    sshUsername: user,
    sshPasswordOnce: pass,
    warnings: allWarnings,
  };
};
