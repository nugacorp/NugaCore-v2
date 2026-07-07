import { store } from '../../state/store';
import { getBillingService } from '../billing/service';
import { getNetworkService } from '../network/service';
import { getSupportService } from '../tickets/service';

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

export async function buildFinancialRows() {
  const invoices = await getBillingService().listInvoices();
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

export async function buildOperationalRows() {
  const [towers, tickets] = await Promise.all([
    getNetworkService().listTowers({}),
    getSupportService().listTickets({}),
  ]);
  const openTickets = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;
  return towers.map((tower) => ({
    towerId: tower.id,
    towerName: tower.name,
    towerStatus: tower.status,
    cpuPct: tower.cpu,
    ramPct: tower.ram,
    pingMs: tower.pingMs,
    sectors: store.NETWORK_SECTORS.filter((sector) => sector.towerId === tower.id).length,
    activeTickets: openTickets,
    timestamp: nowStamp(),
  }));
}

export function buildSecurityRows() {
  return store.SECURITY_AUDIT_LOGS.slice(0, 300).map((row) => ({
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

export async function buildRowsByScope(scope: 'financial' | 'operational' | 'security') {
  if (scope === 'financial') return buildFinancialRows();
  if (scope === 'operational') return buildOperationalRows();
  return buildSecurityRows();
}
