// ====================================================================
// Planificador de comandos RouterOS para Safe Command Queue (PROD-5 prep).
//
// Genera el plan de comandos que un tipo de comando ejecutaría en el router.
// Solo para análisis dry-run / lockout guard — NUNCA se envían al router.
// ====================================================================

import {
  buildReactivateCommands,
  buildSuspendCommands,
  NC_ADDR,
  normalizeAccessListName,
} from '../mikrotik/access-control';
import { SafeCommandType } from './types';

export interface CommandPlanInput {
  commandType: SafeCommandType;
  targetId: string;
  payload: Record<string, unknown>;
}

const str = (payload: Record<string, unknown>, key: string, fallback: string): string => {
  const v = payload[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
};

/** Plan RouterOS alineado con mikrotik/worker (suspensión/reactivación). */
export const planRouterOsCommands = (input: CommandPlanInput): string[] => {
  const { commandType, targetId, payload } = input;
  const pppoeUser = str(payload, 'pppoeUser', targetId);
  const ip = str(payload, 'ip', '0.0.0.0');
  const list = normalizeAccessListName(str(payload, 'addressList', NC_ADDR.suspended));
  const address = str(payload, 'address', ip);

  switch (commandType) {
    case 'SUSPEND_CUSTOMER':
      return buildSuspendCommands(
        { customerId: targetId, ip, pppoeUser },
        { hardCutPpp: true },
      );
    case 'RESTORE_CUSTOMER':
      return buildReactivateCommands(
        { customerId: targetId, ip, pppoeUser },
        { hardCutPpp: true },
      );
    case 'UPDATE_QUEUE':
      return [
        `/queue simple set [find name~"${pppoeUser}"] max-limit=${str(payload, 'maxLimit', '10M/10M')}`,
      ];
    case 'UPDATE_PLAN':
      return [
        `/ppp secret set [find name="${pppoeUser}"] profile=${str(payload, 'profile', 'default')}`,
        `/queue simple set [find name~"${pppoeUser}"] max-limit=${str(payload, 'maxLimit', '20M/20M')}`,
      ];
    case 'ADD_ADDRESS_LIST':
      return [`/ip firewall address-list add list=${list} address=${address} comment="${targetId}"`];
    case 'REMOVE_ADDRESS_LIST':
      return [`/ip firewall address-list remove [find list=${list} address=${address}]`];
    case 'REBOOT_CPE':
      return [`/system reboot`];
    default:
      return [];
  }
};

/** Previsualización humana (español) para la UI — complementa el plan técnico. */
export const describePlannedCommands = (input: CommandPlanInput): string[] => {
  const plan = planRouterOsCommands(input);
  return plan.map((cmd) => `[dry-run] ${cmd}`);
};
