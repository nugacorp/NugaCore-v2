import { store } from '../../state/store';
import { getMetricsSnapshot } from '../system/metrics';
import { buildBillingKpis } from './routes';
import { getCollectionsService } from '../collections/service';
import { getCommercialService } from '../commercial/service';
import { getSupportService } from '../tickets/service';
import { evaluateAllCustomers } from '../suspension/engine';
import { nocReadOnlyService } from '../noc/service';
import { automationService } from '../automation/service';
import { listSlaBreaches } from '../tickets/sla';

/**
 * Cabina de mando WISP OS — agrega las 8 áreas operativas en un solo payload.
 */
export async function buildControlCenter() {
  const [snapshot, billingKpis, suspensionResults, commercialAppts, slaBreaches] = await Promise.all([
    getMetricsSnapshot(),
    buildBillingKpis(),
    evaluateAllCustomers().catch(() => [] as Awaited<ReturnType<typeof evaluateAllCustomers>>),
    getCommercialService().listAppointments({ from: new Date().toISOString().substring(0, 10) }),
    Promise.resolve(listSlaBreaches()),
  ]);

  const wouldSuspend = suspensionResults.filter((r) => r.action === 'create_suspension');

  const workOrders = await getSupportService().listWorkOrders({});
  const pendingInstallations = workOrders.filter((o) => o.status === 'pending' || o.status === 'in_progress').length
    + commercialAppts.filter((a) => a.status === 'scheduled').length;

  const routersOnline = store.MIKROTIK_ROUTERS.filter((r) => r.isOnline).length;
  const routersOffline = store.MIKROTIK_ROUTERS.length - routersOnline;
  const towersByCapacity = store.TOWERS.map((t) => {
    const sectors = store.NETWORK_SECTORS.filter((s) => s.towerId === t.id);
    const clientsOnTower = sectors.reduce((sum, s) => sum + (s.clientsCount ?? 0), 0);
    return { towerId: t.id, towerName: t.name, clientsCount: clientsOnTower, sectorCount: sectors.length, status: t.status };
  });

  const nocSummary = nocReadOnlyService.getSummary();

  const activePromises = await getCollectionsService().getActivePromisesCount();

  return {
    generatedAt: new Date().toISOString(),
    clients: {
      active: snapshot.customers.active,
      suspended: snapshot.serviceStatus.suspended,
      leads: snapshot.customers.leads,
      delinquent: billingKpis.clientesConAdeudo,
      morosos: billingKpis.facturasVencidas,
    },
    finance: {
      revenueTodayCents: Math.round((billingKpis.cobradoMes / 30) * 100),
      revenueMonthCents: Math.round(billingKpis.cobradoMes * 100),
      pendingCollectionCents: Math.round(billingKpis.pendienteCobro * 100),
      invoicedMonthCents: Math.round(billingKpis.facturacionMes * 100),
      activePaymentPromises: activePromises,
    },
    network: {
      routersOnline,
      routersOffline,
      towersOnline: snapshot.towers.online,
      towersOffline: snapshot.towers.offline,
      degradedTargets: snapshot.towers.warning,
    },
    tickets: {
      open: snapshot.tickets.active,
      slaBreaches: slaBreaches.length,
      resolutionPct: snapshot.tickets.total > 0
        ? Math.round((snapshot.tickets.resolved / snapshot.tickets.total) * 100)
        : 100,
    },
    installations: {
      pending: pendingInstallations,
      scheduledToday: commercialAppts.filter((a) => a.scheduledAt.startsWith(new Date().toISOString().substring(0, 10))).length,
    },
    alerts: {
      nocOpen: nocSummary.activeAlerts,
      automationPending: automationService.pendingDecisionsCount(),
    },
    capacity: {
      byTower: towersByCapacity,
      utilizationPct: snapshot.capacity.capacityUtilizationPercent,
    },
    collections: {
      clientsToSuspend: wouldSuspend.length,
      preview: wouldSuspend.slice(0, 10).map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        reason: r.reason,
      })),
      clientsToReactivate: snapshot.serviceStatus.suspended,
    },
  };
}
