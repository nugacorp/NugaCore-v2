// ====================================================================
// Control de acceso cliente en MikroTik (modelo NugaCore).
//
// Mejor que copiar WispHub 1:1:
// - Listas estables en inglés (`nc-*`) — UI puede decir “Moroso/Aviso”.
// - Baseline (filter/NAT) se aplica al conectar el router (plantilla).
// - Ciclo de vida = mover IP entre listas (+ PPP/queue según modo).
// - Portal de pago: lista `nc-mgmt-servers` (IPs del portal NugaCore).
// ====================================================================

/** Listas RouterOS canónicas (no usar nombres de producto ajenos). */
export const NC_ADDR = {
  authorized: 'nc-authorized',
  warning: 'nc-warning',
  suspended: 'nc-suspended',
  /** Destinos siempre alcanzables (portal de pago / API pública). */
  mgmtServers: 'nc-mgmt-servers',
} as const;

export type NcAccessList = (typeof NC_ADDR)[keyof typeof NC_ADDR];

/** Alias legacy → canónico (worker/scripts antiguos). */
export const normalizeAccessListName = (list: string): string => {
  const raw = String(list || '').trim();
  if (!raw) return NC_ADDR.suspended;
  if (/^nugacore[_-]?suspended$/i.test(raw) || raw === 'SUSPENDIDOS' || raw === 'Moroso') {
    return NC_ADDR.suspended;
  }
  if (/^nugacore[_-]?active$/i.test(raw) || raw === 'ips_autorizadas_wisphub') {
    return NC_ADDR.authorized;
  }
  if (raw === 'Aviso') return NC_ADDR.warning;
  return raw;
};

export interface ClientAccessContext {
  customerId: string;
  customerName?: string;
  ip: string;
  pppoeUser?: string;
}

const commentFor = (ctx: ClientAccessContext, action: string): string =>
  `NugaCore ${action} ${ctx.customerId}${ctx.customerName ? ` ${ctx.customerName}` : ''}`;

/** Alta: autorizar IP (+ secreto/queue los arma otro módulo). */
export const buildAuthorizeCommands = (ctx: ClientAccessContext): string[] => {
  const ip = ctx.ip || '0.0.0.0';
  const c = commentFor(ctx, 'active');
  return [
    `/ip firewall address-list remove [find list=${NC_ADDR.suspended} address=${ip}]`,
    `/ip firewall address-list remove [find list=${NC_ADDR.warning} address=${ip}]`,
    `/ip firewall address-list add list=${NC_ADDR.authorized} address=${ip} comment="${c}"`,
  ];
};

/**
 * Suspensión estilo WispHub mejorado:
 * 1) saca de autorizados/aviso
 * 2) mete en suspended (NAT redirige al portal)
 * 3) opcional hard-cut PPP/queue (recomendado para PPPoE)
 */
export const buildSuspendCommands = (
  ctx: ClientAccessContext,
  opts?: { hardCutPpp?: boolean },
): string[] => {
  const ip = ctx.ip || '0.0.0.0';
  const user = ctx.pppoeUser || ctx.customerId;
  const c = commentFor(ctx, 'suspend');
  const cmds = [
    `/ip firewall address-list remove [find list=${NC_ADDR.authorized} address=${ip}]`,
    `/ip firewall address-list remove [find list=${NC_ADDR.warning} address=${ip}]`,
    `/ip firewall address-list add list=${NC_ADDR.suspended} address=${ip} comment="${c}"`,
  ];
  if (opts?.hardCutPpp !== false) {
    cmds.push(
      `/ppp secret disable [find name="${user}"]`,
      `/queue simple disable [find name~"${user}"]`,
    );
  }
  return cmds;
};

export const buildReactivateCommands = (
  ctx: ClientAccessContext,
  opts?: { hardCutPpp?: boolean },
): string[] => {
  const ip = ctx.ip || '0.0.0.0';
  const user = ctx.pppoeUser || ctx.customerId;
  const c = commentFor(ctx, 'active');
  const cmds = [
    `/ip firewall address-list remove [find list=${NC_ADDR.suspended} address=${ip}]`,
    `/ip firewall address-list remove [find list=${NC_ADDR.warning} address=${ip}]`,
    `/ip firewall address-list add list=${NC_ADDR.authorized} address=${ip} comment="${c}"`,
  ];
  if (opts?.hardCutPpp !== false) {
    cmds.push(
      `/ppp secret enable [find name="${user}"]`,
      `/queue simple enable [find name~"${user}"]`,
    );
  }
  return cmds;
};

/**
 * Aviso de pago (modelo WispHub mejorado):
 * no saca de nc-authorized (sigue navegando); solo marca nc-warning
 * para que el NAT redirija HTTP al portal.
 */
export const buildWarningCommands = (ctx: ClientAccessContext): string[] => {
  const ip = ctx.ip || '0.0.0.0';
  const c = commentFor(ctx, 'warning');
  return [
    `/ip firewall address-list remove [find list=${NC_ADDR.suspended} address=${ip}]`,
    `/ip firewall address-list remove [find list=${NC_ADDR.warning} address=${ip}]`,
    `/ip firewall address-list add list=${NC_ADDR.warning} address=${ip} comment="${c}"`,
  ];
};
