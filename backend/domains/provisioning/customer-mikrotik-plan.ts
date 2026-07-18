// ====================================================================
// Plan de ejecución RouterOS para alta de cliente.
//
// Construye pasos descriptivos (y comandos previstos) a partir de datos
// REALES: plan (megas), cliente (nombre/IP/PPPoE) y tipo de acceso.
// La ejecución live sigue gated por PROVISIONING_EXECUTE / worker commit.
// ====================================================================

import type { Client, Plan } from '../../../src/types';
import { buildAuthorizeCommands } from '../mikrotik/access-control';

export interface CustomerMikrotikPlanContext {
  client: Pick<Client, 'id' | 'name'> &
    Partial<Pick<Client, 'pppoeUser' | 'pppoePassword' | 'assignedIp' | 'ip' | 'routerId'>>;
  plan: Pick<Plan, 'id' | 'name' | 'speedMbpsDown' | 'speedMbpsUp' | 'type'>;
  zoneName?: string;
  billingCycleDay?: number;
  billingCycleTime?: string;
  routerName?: string;
}

const rateLimit = (downMbps: number, upMbps: number): string =>
  `${Math.max(1, upMbps)}M/${Math.max(1, downMbps)}M`;

/** Comandos RouterOS previstos (no se ejecutan aquí). */
export const buildCustomerMikrotikCommands = (ctx: CustomerMikrotikPlanContext): string[] => {
  const ip = ctx.client.assignedIp || ctx.client.ip || '0.0.0.0';
  const user = ctx.client.pppoeUser || ctx.client.id;
  const pass = ctx.client.pppoePassword || 'CHANGE_ME';
  const comment = `${ctx.client.name} · ${ctx.plan.name}${ctx.zoneName ? ` · ${ctx.zoneName}` : ''}`;
  const limit = rateLimit(ctx.plan.speedMbpsDown, ctx.plan.speedMbpsUp);
  const queueName = `q-${user}`;

  const authorize = buildAuthorizeCommands({
    customerId: ctx.client.id,
    customerName: ctx.client.name,
    ip,
    pppoeUser: user,
  });

  switch (ctx.plan.type) {
    case 'PPPoE':
      return [
        `/ppp secret add name="${user}" password="${pass}" service=pppoe profile=default comment="${comment}"`,
        `/queue simple add name="${queueName}" target=${ip}/32 max-limit=${limit} comment="${comment}"`,
        ...authorize,
      ];
    case 'Hotspot':
      return [
        `/ip hotspot user add name="${user}" password="${pass}" profile=default comment="${comment}"`,
        `/queue simple add name="${queueName}" target=${ip}/32 max-limit=${limit} comment="${comment}"`,
        ...authorize,
      ];
    case 'DHCP':
    case 'Static':
    default:
      return [
        `/queue simple add name="${queueName}" target=${ip}/32 max-limit=${limit} comment="${comment}"`,
        ...authorize,
      ];
  }
};

export const buildCustomerMikrotikPlanSteps = (ctx: CustomerMikrotikPlanContext): string[] => {
  const commands = buildCustomerMikrotikCommands(ctx);
  const cutOff =
    ctx.billingCycleDay != null
      ? `Corte de zona día ${ctx.billingCycleDay}${ctx.billingCycleTime ? ` @ ${ctx.billingCycleTime}` : ''} (suspende en MikroTik si no paga).`
      : 'Corte: usar política de facturación del tenant.';

  return [
    `Zona/router: ${ctx.zoneName || 'sin zona'} → ${ctx.routerName || ctx.client.routerId || 'router N/D'}.`,
    `Plan ${ctx.plan.name}: ${ctx.plan.speedMbpsDown}/${ctx.plan.speedMbpsUp} Mbps (${ctx.plan.type}).`,
    `Cliente ${ctx.client.name} IP ${ctx.client.assignedIp || ctx.client.ip || 'N/D'} PPPoE=${ctx.client.pppoeUser || 'N/D'}.`,
    cutOff,
    ...commands.map((cmd) => `RouterOS previsto: ${cmd}`),
  ];
};
