import { Router } from 'express';
import { store } from '../../../backend/state/store';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { suspensionKpis } from '../suspension/engine';
import { ipamService } from '../ipam/service';
import { customerEquipmentService } from '../inventory/customer-equipment/service';
import { getBillingService } from '../billing/service';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const buildExecutiveKpis = () => {
  const now = new Date();
  const currentMonth = monthKey(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonth = monthKey(prev);

  const activeCount = store.CLIENTS.filter((c) => c.status === 'active').length;
  const suspendedCount = store.CLIENTS.filter((c) => c.status === 'suspended').length;
  const leadsCount = store.CLIENTS.filter((c) => c.status === 'lead').length;
  const offlineClients = suspendedCount + store.CLIENTS.filter((c) => c.status === 'baja').length;

  const totalMrr = store.CLIENTS.reduce((acc, c) => {
    if (c.status === 'active' || c.status === 'suspended') {
      const plan = store.PLANS.find((p) => p.id === c.planId);
      return acc + (plan ? plan.price : 0);
    }
    return acc;
  }, 0);

  const invoicesByMonth = store.INVOICES.reduce<Record<string, { facturado: number; cobrado: number }>>((acc, invoice) => {
    const key = String(invoice.dateStr || '').substring(0, 7);
    if (!key) return acc;
    if (!acc[key]) {
      acc[key] = { facturado: 0, cobrado: 0 };
    }
    acc[key].facturado += invoice.amount;
    if (invoice.status === 'paid') {
      acc[key].cobrado += invoice.amount;
    }
    return acc;
  }, {});

  const currentRevenue = invoicesByMonth[currentMonth]?.facturado || 0;
  const previousRevenue = invoicesByMonth[previousMonth]?.facturado || 0;
  const currentCollection = invoicesByMonth[currentMonth]?.cobrado || 0;

  const monthlyGrowthPct = previousRevenue > 0
    ? Number((((currentRevenue - previousRevenue) / previousRevenue) * 100).toFixed(2))
    : currentRevenue > 0 ? 100 : 0;

  const leadConversionsCurrentMonth = store.CLIENT_TIMELINE.filter((event) => (
    event.eventType === 'lead_conversion' && String(event.createdAt).startsWith(currentMonth)
  )).length;
  const leadConversionsPreviousMonth = store.CLIENT_TIMELINE.filter((event) => (
    event.eventType === 'lead_conversion' && String(event.createdAt).startsWith(previousMonth)
  )).length;

  const clientGrowthPct = leadConversionsPreviousMonth > 0
    ? Number((((leadConversionsCurrentMonth - leadConversionsPreviousMonth) / leadConversionsPreviousMonth) * 100).toFixed(2))
    : leadConversionsCurrentMonth > 0 ? 100 : 0;

  const activeTickets = store.TICKETS.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;
  const resolvedTickets = store.TICKETS.filter((t) => t.status === 'resolved' || t.status === 'closed').length;
  const totalTickets = activeTickets + resolvedTickets;
  const ticketResolutionPct = totalTickets > 0 ? Number(((resolvedTickets / totalTickets) * 100).toFixed(2)) : 100;

  const towersOnline = store.TOWERS.filter((t) => t.status === 'online').length;
  const towersWarning = store.TOWERS.filter((t) => t.status === 'warning').length;
  const towersOffline = store.TOWERS.filter((t) => t.status === 'offline').length;
  const towerAvailabilityPct = store.TOWERS.length > 0
    ? Number((((towersOnline + towersWarning * 0.5) / store.TOWERS.length) * 100).toFixed(2))
    : 100;

  const monitoring = calculateMonitoringOverview();
  const totalNetworkOffline = monitoring.onlineOffline.offlineTargets + towersOffline + store.ONUS.filter((o) => o.status !== 'online').length;

  return {
    generatedAt: nowStamp(),
    customers: {
      active: activeCount,
      suspended: suspendedCount,
      leads: leadsCount,
      offline: offlineClients,
      growthPct: clientGrowthPct,
      leadConversionsCurrentMonth,
    },
    revenue: {
      mrr: totalMrr,
      currentMonth: currentRevenue,
      previousMonth: previousRevenue,
      collectionCurrentMonth: currentCollection,
      monthlyGrowthPct,
      collectionRatePct: currentRevenue > 0 ? Number(((currentCollection / currentRevenue) * 100).toFixed(2)) : 0,
    },
    tickets: {
      active: activeTickets,
      resolved: resolvedTickets,
      total: totalTickets,
      resolutionPct: ticketResolutionPct,
    },
    towers: {
      online: towersOnline,
      warning: towersWarning,
      offline: towersOffline,
      availabilityPct: towerAvailabilityPct,
    },
    network: {
      totalOffline: totalNetworkOffline,
      avgLatencyMs: monitoring.ping.avgLatencyMs,
      degradedTargets: monitoring.onlineOffline.degradedTargets,
    },
  };
};

const buildRevenueTrend = (months = 6) => {
  const keys: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }

  const trend = keys.map((key) => {
    const invoices = store.INVOICES.filter((inv) => String(inv.dateStr || '').startsWith(key));
    const facturado = invoices.reduce((acc, inv) => acc + inv.amount, 0);
    const cobrado = invoices.filter((inv) => inv.status === 'paid').reduce((acc, inv) => acc + inv.amount, 0);
    return {
      month: key,
      facturado,
      cobrado,
      collectionRatePct: facturado > 0 ? Number(((cobrado / facturado) * 100).toFixed(2)) : 0,
    };
  });

  return trend;
};

const evaluateMonitoringStatus = (latencyMs: number, packetLossPct: number): 'online' | 'offline' | 'degraded' => {
  if (packetLossPct >= 90 || latencyMs < 0) return 'offline';
  if (packetLossPct > 5 || latencyMs > 90) return 'degraded';
  return 'online';
};

const calculateMonitoringOverview = () => {
  const lastSamples = store.MONITORING_SNAPSHOTS.slice(0, 25);
  const avgLatencyMs = lastSamples.length
    ? Math.round(lastSamples.reduce((acc, item) => acc + item.latencyMs, 0) / lastSamples.length)
    : 0;

  const onlineTargets = lastSamples.filter((item) => item.status === 'online').length;
  const degradedTargets = lastSamples.filter((item) => item.status === 'degraded').length;
  const offlineTargets = lastSamples.filter((item) => item.status === 'offline').length;

  return {
    generatedAt: nowStamp(),
    ping: {
      avgLatencyMs,
      maxLatencyMs: lastSamples.length ? Math.max(...lastSamples.map((item) => item.latencyMs)) : 0,
      minLatencyMs: lastSamples.length ? Math.min(...lastSamples.map((item) => item.latencyMs)) : 0,
    },
    onlineOffline: {
      onlineTargets,
      degradedTargets,
      offlineTargets,
    },
    byDomain: {
      towers: {
        online: store.TOWERS.filter((item) => item.status === 'online').length,
        warning: store.TOWERS.filter((item) => item.status === 'warning').length,
        offline: store.TOWERS.filter((item) => item.status === 'offline').length,
      },
      onus: {
        online: store.ONUS.filter((item) => item.status === 'online').length,
        offline: store.ONUS.filter((item) => item.status !== 'online').length,
      },
      routers: {
        online: store.MIKROTIK_ROUTERS.filter((item) => item.isOnline).length,
        offline: store.MIKROTIK_ROUTERS.filter((item) => !item.isOnline).length,
      },
    },
  };
};

router.get('/api/dashboard-stats', requireRoles(READ_ROLES), async (_req, res) => {
  const kpis = buildExecutiveKpis();
  const monthCobranza = store.INVOICES.filter((f) => f.status === 'paid').reduce((acc, f) => acc + f.amount, 0);
  const monthFacturacion = store.INVOICES.reduce((acc, f) => acc + f.amount, 0);
  const suspension = await suspensionKpis();
  const ipamRouters = await ipamService.listRouters();
  const capacities = (
    await Promise.all(ipamRouters.map((item) => ipamService.capacity(item.id)))
  ).filter((item): item is NonNullable<typeof item> => item !== null);
  const reservedEquipment = customerEquipmentService.countReservations();
  const pendingInstallations = (
    store.WORK_ORDERS.filter(
      (order) => order.type === 'installation' && order.status !== 'canceled' && order.status !== 'completed',
    ).length + reservedEquipment
  );

  res.json({
    activeClients: kpis.customers.active,
    suspendedClients: kpis.customers.suspended,
    leadsCount: kpis.customers.leads,
    mrr: kpis.revenue.mrr,
    cobranzaMes: monthCobranza,
    facturacionMes: monthFacturacion,
    activeTickets: kpis.tickets.active,
    towers: { online: kpis.towers.online, warning: kpis.towers.warning, offline: kpis.towers.offline },
    oltStats: { connected: store.ONUS.filter((o) => o.status === 'online').length, offlineOnus: store.ONUS.filter((o) => o.status !== 'online').length },
    growth: {
      revenueMonthlyPct: kpis.revenue.monthlyGrowthPct,
      clientsMonthlyPct: kpis.customers.growthPct,
    },
    executive: {
      offlineTotal: kpis.network.totalOffline,
      ticketResolutionPct: kpis.tickets.resolutionPct,
      towerAvailabilityPct: kpis.towers.availabilityPct,
      collectionRatePct: kpis.revenue.collectionRatePct,
    },
    // Motor de Suspensiones (Fase 4.5/4.5.1) — read-only, sin efectos.
    suspension,
    wispOperations: {
      clientsByTower: capacities.map((capacity) => ({
        routerId: capacity.routerId,
        routerName: capacity.routerName,
        activeClients: capacity.activeClients,
      })),
      capacityUtilizationPercent: capacities.length > 0
        ? Number(
            (
              capacities.reduce((sum, item) => sum + item.utilizationPercent, 0) /
              capacities.length
            ).toFixed(2),
          )
        : 0,
      reservedEquipment,
      pendingInstallations,
    },
  });
});

router.get('/api/dashboard/executive-summary', requireRoles(READ_ROLES), (_req, res) => {
  const kpis = buildExecutiveKpis();
  const trend = buildRevenueTrend(6);

  res.json({
    kpis,
    trend,
    highlights: [
      `Crecimiento mensual de ingresos: ${kpis.revenue.monthlyGrowthPct}%`,
      `Resolucion de tickets: ${kpis.tickets.resolutionPct}%`,
      `Disponibilidad de torres: ${kpis.towers.availabilityPct}%`,
      `Nodos/servicios fuera de linea: ${kpis.network.totalOffline}`,
    ],
  });
});

router.get('/api/dashboard/kpi-trends', requireRoles(READ_ROLES), (req, res) => {
  const months = Math.max(3, Math.min(12, Number(req.query.months) || 6));
  res.json({
    generatedAt: nowStamp(),
    months,
    revenue: buildRevenueTrend(months),
  });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/dashboard/billing-kpis  (FASE E — KPIs ejecutivos de cobranza)
//
// Lee a través del BillingService → respeta USE_DB_BILLING (mock o DB).
// KPIs: facturación del mes, cobrado del mes, pendiente de cobro,
//       clientes con adeudo, facturas vencidas y Top 10 adeudos.
// ────────────────────────────────────────────────────────────────────
router.get('/api/dashboard/billing-kpis', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  const month = monthKey(new Date());
  const invoices = (await getBillingService().listInvoices()).filter((inv) => inv.status !== 'canceled');

  const round = (v: number) => Math.round(v * 100) / 100;
  const issuedThisMonth = invoices.filter((inv) => String(inv.dateStr || '').startsWith(month));

  const facturacionMes = round(issuedThisMonth.reduce((s, inv) => s + inv.amount, 0));
  const cobradoMes = round(issuedThisMonth.reduce((s, inv) => s + (inv.paidAmount || 0), 0));
  const pendienteCobro = round(invoices.reduce((s, inv) => s + (inv.pendingAmount || 0), 0));

  const withDebt = new Set(invoices.filter((inv) => (inv.pendingAmount || 0) > 0).map((inv) => inv.clientId));
  const facturasVencidas = invoices.filter((inv) => inv.status === 'overdue').length;

  const topAdeudos = invoices
    .filter((inv) => (inv.pendingAmount || 0) > 0)
    .sort((a, b) => (b.pendingAmount || 0) - (a.pendingAmount || 0))
    .slice(0, 10)
    .map((inv) => ({
      invoiceId: inv.id,
      clientId: inv.clientId,
      clientName: inv.clientName,
      pendingAmount: round(inv.pendingAmount || 0),
      dueDateStr: inv.dueDateStr,
      status: inv.status,
    }));

  res.json({
    generatedAt: nowStamp(),
    month,
    facturacionMes,
    cobradoMes,
    pendienteCobro,
    clientesConAdeudo: withDebt.size,
    facturasVencidas,
    topAdeudos,
  });
}));

router.get('/api/notifications/settings', requireRoles(READ_ROLES), (_req, res) => {
  res.json(store.NOTIFICATION_SETTINGS);
});

router.post('/api/notifications/settings', requireRoles(['super admin', 'administrador']), (req, res) => {
  const { pushEnabled, latencyThresholdMs, fiberCutAlertEnabled, browserSubscribed } = req.body;
  if (pushEnabled !== undefined) store.NOTIFICATION_SETTINGS.pushEnabled = !!pushEnabled;
  if (latencyThresholdMs !== undefined) store.NOTIFICATION_SETTINGS.latencyThresholdMs = Number(latencyThresholdMs);
  if (fiberCutAlertEnabled !== undefined) store.NOTIFICATION_SETTINGS.fiberCutAlertEnabled = !!fiberCutAlertEnabled;
  if (browserSubscribed !== undefined) store.NOTIFICATION_SETTINGS.browserSubscribed = !!browserSubscribed;
  res.json(store.NOTIFICATION_SETTINGS);
});

router.post('/api/notifications/trigger-simulation', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const { eventType, metricValue, source } = req.body;

  if (eventType === 'latency') {
    const threshold = store.NOTIFICATION_SETTINGS.latencyThresholdMs;
    const latency = Number(metricValue) || 150;
    const targetSource = source || 'Backhaul Troncal Ajusco-Chilpancingo';

    if (latency >= threshold) {
      store.createAlert(
        'tower',
        latency >= 180 ? 'critical' : 'warning',
        targetSource,
        `[LATENCY ALERT] Enlace de microondas ${targetSource} reporta latencia de ${latency}ms, superando el umbral critico configurado de ${threshold}ms.`,
      );
      res.json({
        triggered: true,
        message: `Alerta emitida: Latencia ${latency}ms supera el limite de ${threshold}ms en ${targetSource}.`,
        notificationPayload: {
          title: 'Latencia Critica en Backhaul',
          body: `Enlace ${targetSource} registra ${latency}ms (Limite: ${threshold}ms).`,
          icon: '/favicon.ico',
          tag: 'noc-latency',
        },
      });
    } else {
      res.json({
        triggered: false,
        message: `Latencia de ${latency}ms esta dentro del limite de ${threshold}ms. No se requirio accion.`,
      });
    }
  } else if (eventType === 'fibercut') {
    const targetSource = source || 'Anillo de Fibra GPON Centro - Sector N1';
    if (store.NOTIFICATION_SETTINGS.fiberCutAlertEnabled) {
      store.createAlert(
        'olt',
        'critical',
        targetSource,
        `[FIBER CUT ALERT] CRITICO: Atenuacion extrema de -42dB detectada en ${targetSource}. Posible rotura fisica o vandalismo de fibra troncal.`,
      );
      res.json({
        triggered: true,
        message: `Alerta de rotura emitida para ${targetSource}.`,
        notificationPayload: {
          title: 'Rotura o Corte de Fibra',
          body: `Caida de senal inmediata en ${targetSource}. Atenuacion critica en curso.`,
          icon: '/favicon.ico',
          tag: 'noc-fibercut',
        },
      });
    } else {
      res.json({
        triggered: false,
        message: 'Las alertas de corte de fibra estan desactivadas temporalmente.',
      });
    }
  } else {
    res.status(400).json({ error: 'Tipo de simulacion desconocido' });
  }
});

router.get('/api/alerts', requireRoles(READ_ROLES), (_req, res) => res.json(store.NOC_ALERTS));

router.get('/api/monitoring/overview', requireRoles(READ_ROLES), (_req, res) => {
  res.json(calculateMonitoringOverview());
});

router.get('/api/monitoring/snapshots', requireRoles(READ_ROLES), (req, res) => {
  const targetType = String(req.query.targetType || '').trim().toLowerCase();
  const targetId = String(req.query.targetId || '').trim();
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));

  const rows = store.MONITORING_SNAPSHOTS
    .filter((item) => {
      const matchesType = !targetType || item.targetType === targetType;
      const matchesTarget = !targetId || item.targetId === targetId;
      return matchesType && matchesTarget;
    })
    .slice(0, limit);

  res.json(rows);
});

router.get('/api/monitoring/targets', requireRoles(READ_ROLES), (_req, res) => {
  const targets = [
    ...store.TOWERS.map((tower) => ({ id: tower.id, label: tower.name, ip: tower.ip, targetType: 'tower' })),
    ...store.OLTS.map((olt) => ({ id: olt.id, label: olt.name, ip: olt.ip, targetType: 'olt' })),
    ...store.MIKROTIK_ROUTERS.map((router) => ({ id: router.id, label: router.name, ip: router.ipAddress, targetType: 'router' })),
  ];

  res.json(targets);
});

router.post('/api/monitoring/ping-scan', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const targets = Array.isArray(req.body.targets) ? req.body.targets : [];

  const resolvedTargets = targets.length > 0
    ? targets
    : [
      ...store.TOWERS.map((tower) => ({ id: tower.id, label: tower.name, targetType: 'tower' })),
      ...store.OLTS.map((olt) => ({ id: olt.id, label: olt.name, targetType: 'olt' })),
      ...store.MIKROTIK_ROUTERS.map((router) => ({ id: router.id, label: router.name, targetType: 'router' })),
    ];

  const results = resolvedTargets.map((target: { id: string; label: string; targetType: 'tower' | 'olt' | 'router' | 'client' }) => {
    const jitter = Math.floor(Math.random() * 45);
    const packetLossPct = Math.floor(Math.random() * 8);
    const latencyMs = 8 + jitter;
    const status = evaluateMonitoringStatus(latencyMs, packetLossPct);

    store.logMonitoringSnapshot({
      targetId: target.id,
      targetType: target.targetType,
      targetLabel: target.label,
      status,
      latencyMs,
      packetLossPct,
    });

    if (status !== 'online') {
      store.createAlert(
        target.targetType === 'olt' ? 'olt' : 'tower',
        status === 'offline' ? 'critical' : 'warning',
        target.label,
        status === 'offline'
          ? `[MONITORING] Objetivo sin conectividad durante barrido ICMP. Latencia: ${latencyMs}ms, perdida: ${packetLossPct}%.`
          : `[MONITORING] Objetivo con latencia degradada. Latencia: ${latencyMs}ms, perdida: ${packetLossPct}%.`,
      );
    }

    return {
      targetId: target.id,
      targetLabel: target.label,
      targetType: target.targetType,
      status,
      latencyMs,
      packetLossPct,
      scannedAt: nowStamp(),
    };
  });

  res.json({
    scannedAt: nowStamp(),
    total: results.length,
    results,
    overview: calculateMonitoringOverview(),
  });
});

router.post('/api/monitoring/basic-alert-rules', requireRoles(['super admin', 'administrador', 'tecnico']), (_req, res) => {
  const threshold = store.NOTIFICATION_SETTINGS.latencyThresholdMs;
  const recent = store.MONITORING_SNAPSHOTS.slice(0, 30);
  const triggered = recent.filter((row) => row.latencyMs >= threshold || row.status !== 'online');

  triggered.forEach((row) => {
    store.createAlert(
      row.targetType === 'olt' ? 'olt' : 'tower',
      row.status === 'offline' ? 'critical' : 'warning',
      row.targetLabel,
      `[BASIC RULE] Threshold breach ${row.latencyMs}ms / perdida ${row.packetLossPct}% (umbral ${threshold}ms).`,
    );
  });

  res.json({
    evaluatedAt: nowStamp(),
    threshold,
    checkedSamples: recent.length,
    triggered: triggered.length,
  });
});

router.post('/api/alerts/acknowledge-all', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (_req, res) => {
  store.NOC_ALERTS.forEach((a) => {
    a.acknowledged = true;
  });
  res.json(store.NOC_ALERTS);
});

export default router;
