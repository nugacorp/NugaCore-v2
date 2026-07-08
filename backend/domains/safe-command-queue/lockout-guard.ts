// ====================================================================
// Lockout guard — análisis de riesgo de auto-bloqueo administrativo.
//
// Funciones puras inspiradas en patrones NMS (safe-apply lockout guard).
// Evalúa si un plan de comandos podría bloquear el acceso de gestión
// (VPN, API, CIDR de administración) sin ejecutar nada en el router.
// ====================================================================

export type LockoutRisk = 'none' | 'possible' | 'blocked';

export interface RouterPostureSnapshot {
  /** CIDR de gestión NugaCore (p. ej. 10.0.0.0/24). */
  managementCidr?: string;
  /** CIDR de la VPN de administración (p. ej. 10.10.0.0/24). */
  vpnCidr?: string;
  /** Si el input-chain tiene reglas drop/reject sin scope. */
  inputChainHasUnscopedDrop?: boolean;
}

export interface LockoutAnalysis {
  risk: LockoutRisk;
  blocked: boolean;
  warnings: string[];
}

const DROP_RE = /action=(drop|reject)/i;
const INPUT_CHAIN_RE = /chain=input/i;
const ADDRESS_LIST_RE = /\/ip firewall address-list add/i;
const REBOOT_RE = /\/system reboot/i;
const INPUT_FILTER_ADD_RE = /\/ip firewall filter add/i;

const ipInCidr = (ip: string, cidr: string): boolean => {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number.parseInt(bitsStr ?? '32', 10);
  if (!base || !Number.isFinite(bits)) return false;
  const toInt = (addr: string): number | null => {
    const parts = addr.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const ipInt = toInt(ip);
  const baseInt = toInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
};

const extractAddressFromCommand = (command: string): string | null => {
  const m = command.match(/address=([0-9.]+)/i);
  return m?.[1] ?? null;
};

/**
 * Analiza un plan de comandos RouterOS y devuelve riesgo de lockout.
 * No ejecuta nada; solo heurísticas sobre el texto del plan.
 */
export const analyzeLockoutRisk = (
  plannedCommands: string[],
  posture: RouterPostureSnapshot = {},
): LockoutAnalysis => {
  const warnings: string[] = [];
  let risk: LockoutRisk = 'none';

  const mgmt = posture.managementCidr?.trim();
  const vpn = posture.vpnCidr?.trim();

  for (const cmd of plannedCommands) {
    if (REBOOT_RE.test(cmd)) {
      warnings.push('Reinicio del equipo: interrumpe acceso de gestión hasta que vuelva en línea.');
      risk = elevate(risk, 'possible');
    }

    if (INPUT_FILTER_ADD_RE.test(cmd) && DROP_RE.test(cmd) && INPUT_CHAIN_RE.test(cmd)) {
      const hasScope =
        /src-address=/i.test(cmd) ||
        /dst-address=/i.test(cmd) ||
        /src-address-list=/i.test(cmd) ||
        /in-interface=/i.test(cmd);
      if (!hasScope) {
        warnings.push(
          'Regla input drop/reject sin scope detectada: podría bloquear acceso administrativo al router.',
        );
        risk = 'blocked';
      } else {
        warnings.push('Regla firewall input con drop/reject: revisar que no afecte la VPN/API de gestión.');
        risk = elevate(risk, 'possible');
      }
    }

    if (ADDRESS_LIST_RE.test(cmd)) {
      const addr = extractAddressFromCommand(cmd);
      if (addr && mgmt && ipInCidr(addr, mgmt)) {
        warnings.push(`La dirección ${addr} cae dentro del CIDR de gestión (${mgmt}).`);
        risk = 'blocked';
      }
      if (addr && vpn && ipInCidr(addr, vpn)) {
        warnings.push(`La dirección ${addr} cae dentro del CIDR VPN (${vpn}).`);
        risk = elevate(risk, 'possible');
      }
    }
  }

  if (posture.inputChainHasUnscopedDrop) {
    warnings.push('El router reporta reglas input drop/reject sin scope — precaución extra al modificar firewall.');
    risk = elevate(risk, 'possible');
  }

  return {
    risk,
    blocked: risk === 'blocked',
    warnings,
  };
};

const elevate = (current: LockoutRisk, next: LockoutRisk): LockoutRisk => {
  const order: LockoutRisk[] = ['none', 'possible', 'blocked'];
  return order[Math.max(order.indexOf(current), order.indexOf(next))];
};

/** Lee CIDRs de gestión desde variables de entorno (sin secretos). */
export const readManagementPostureFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): RouterPostureSnapshot => ({
  managementCidr: (env.MIKROTIK_MGMT_CIDR ?? '10.0.0.0/24').trim(),
  vpnCidr: (env.MIKROTIK_VPN_CIDR ?? '10.10.0.0/24').trim(),
});
