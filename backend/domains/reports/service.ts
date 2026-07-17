import { getBillingService } from '../billing/service';
import { getNetworkService } from '../network/service';
import { getSupportService } from '../tickets/service';
import { listSecurityAuditLogs } from '../security/audit-log';

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

export async function buildFinancialRows(tenantId?: string) {
  const invoices = await getBillingService().listInvoices(tenantId);
  return invoices.map((invoice) => {
    const paidAmount = invoice.payments?.reduce((acc, payment) => acc + Number(payment.amount || 0), 0)
      ?? invoice.paidAmount
      ?? 0;
    const pendingAmount = invoice.pendingAmount ?? Math.max(invoice.amount - paidAmount, 0);
    return {
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      clientName: invoice.clientName,
      amount: invoice.amount,
      paidAmount,
      pendingAmount,
      status: invoice.status,
      dueDate: invoice.dueDateStr,
      paymentsCount: invoice.payments?.length ?? 0,
    };
  });
}

export async function buildOperationalRows(tenantId?: string) {
  const [towers, tickets, sectors] = await Promise.all([
    getNetworkService().listTowers({ tenantId }),
    getSupportService().listTickets({}, tenantId),
    getNetworkService().listSectors({ tenantId }),
  ]);
  const openTickets = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;
  return towers.map((tower) => ({
    towerId: tower.id,
    towerName: tower.name,
    towerStatus: tower.status,
    cpuPct: tower.cpu,
    ramPct: tower.ram,
    pingMs: tower.pingMs,
    sectors: sectors.filter((sector) => sector.towerId === tower.id).length,
    activeTickets: openTickets,
    timestamp: nowStamp(),
  }));
}

export function buildSecurityRows() {
  return listSecurityAuditLogs(300).map((row) => ({
    id: row.id,
    actorId: row.actorId || 'anonymous',
    actorRole: row.actorRole || 'unknown',
    action: row.action,
    resource: row.resource,
    method: row.method,
    statusCode: row.statusCode,
    success: row.success,
    source: row.source,
    createdAt: row.createdAt,
  }));
}

export async function buildRowsByScope(
  scope: 'financial' | 'operational' | 'security',
  tenantId?: string,
) {
  if (scope === 'financial') return buildFinancialRows(tenantId);
  if (scope === 'operational') return buildOperationalRows(tenantId);
  return buildSecurityRows();
}
