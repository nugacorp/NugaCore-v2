import { Router } from 'express';
import { store } from '../../../backend/state/store';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { suspensionKpis } from '../suspension/engine';
import {
  getBillingMetrics,
  getMetricsSnapshot,
  type MetricsSnapshot,
} from '../system/metrics';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

// Ingresos del mes previo derivados del histórico de facturas (para el
// cálculo de crecimiento). El mes en curso viene de Billing (SSOT).
const monthRevenueFromStore = (key: string): number =>
  store.INVOICES
    .filter((inv) => String(inv.dateStr || '').startsWith(key))
    .reduce((acc, inv) => acc + inv.amount, 0);

// Deriva los KPIs ejecutivos (tasas y tendencias) a partir del snapshot SSOT.
// Los conteos base (clientes, MRR, tickets, torres, cobranza del mes) NO se
// recalculan aquí: provienen de systemMetrics (fuente oficial por dominio).
const buildExecutiveKpis = (snapshot: MetricsSnapshot) => {
  const now = new Date();
  const currentMonth = monthKey(now);
  const previousMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const currentRevenue = snapshot.billing.facturacionMes;
  const previousRevenue = monthRevenueFromStore(previousMonth);
  const currentCollection = snapshot.billing.cobradoMes;

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

  const ticketResolutionPct = snapshot.tickets.total > 0
    ? Number(((snapshot.tickets.resolved / snapshot.tickets.total) * 100).toFixed(2))
    : 100;

  const monitoring = calculateMonitoringOverview();
  const totalNetworkOffline = monitoring.onlineOffline.offlineTargets + snapshot.towers.offline + store.ONUS.filter((o) => o.status !== 'online').length;

  return {
    generatedAt: snapshot.generatedAt,
    customers: {
      active: snapshot.customers.active,
      suspended: snapshot.customers.suspended,
      leads: snapshot.customers.leads,
      offline: snapshot.customers.offline,
      growthPct: clientGrowthPct,
      leadConversionsCurrentMonth,
    },
    revenue: {
      mrr: snapshot.billing.mrr,
      currentMonth: currentRevenue,
      previousMonth: previousRevenue,
      collectionCurrentMonth: currentCollection,
      monthlyGrowthPct,
      collectionRatePct: currentRevenue > 0 ? Number(((currentCollection / currentRevenue) * 100).toFixed(2)) : 0,
    },
    tickets: {
      active: snapshot.tickets.active,
      resolved: snapshot.tickets.resolved,
      total: snapshot.tickets.total,
      resolutionPct: ticketResolutionPct,
    },
    towers: {
      online: snapshot.towers.online,
      warning: snapshot.towers.warning,
      offline: snapshot.towers.offline,
      availabilityPct: snapshot.towers.availabilityPct,
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

// ────────────────────────────────────────────────────────────────────
// buildDashboardStats — payload de /api/dashboard-stats.
//
// Todos los KPIs se sirven desde systemMetrics (SSOT). En particular,
// `cobranzaMes` y `facturacionMes` son AHORA los del mes en curso vía Billing
// (antes sumaban el histórico completo, inconsistentes con billing-kpis).
// Exportado para que el auditor de consistencia valide el cableado real.
// ────────────────────────────────────────────────────────────────────
export async function buildDashboardStats() {
  const snapshot = await getMetricsSnapshot();
  const kpis = buildExecutiveKpis(snapshot);
  // Motor de Suspensiones (Fase 4.5/4.5.1) — read-only, sin efectos.
  const suspension = await suspensionKpis();

  return {
    activeClients: snapshot.customers.active,
    suspendedClients: snapshot.customers.suspended,
    leadsCount: snapshot.customers.leads,
    mrr: snapshot.billing.mrr,
    cobranzaMes: snapshot.billing.cobradoMes,
    facturacionMes: snapshot.billing.facturacionMes,
    activeTickets: snapshot.tickets.active,
    towers: { online: snapshot.towers.online, warning: snapshot.towers.warning, offline: snapshot.towers.offline },
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
    suspension,
    wispOperations: {
      clientsByTower: snapshot.capacity.clientsByTower,
      capacityUtilizationPercent: snapshot.capacity.capacityUtilizationPercent,
      reservedEquipment: snapshot.inventory.reservedEquipment,
      pendingInstallations: snapshot.inventory.pendingInstallations,
    },
  };
}

router.get('/api/dashboard-stats', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await buildDashboardStats());
}));

router.get('/api/dashboard/executive-summary', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  const snapshot = await getMetricsSnapshot();
  const kpis = buildExecutiveKpis(snapshot);
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
}));

router.get('/api/dashboard/kpi-trends', requireRoles(READ_ROLES), (req, res) => {
  const months = Math.max(3, Math.min(12, Number(req.query.months) || 6));
  res.json({
    generatedAt: nowStamp(),
    months,
    revenue: buildRevenueTrend(months),
  });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/dashboard/billing-kpis  (KPIs ejecutivos de cobranza)
//
// Lee a través de systemMetrics.billing() (BillingService, SSOT) → respeta
// USE_DB_BILLING. La MISMA lógica que alimenta `cobranzaMes`/`facturacionMes`
// del dashboard: una sola fuente, sin recálculos divergentes.
// ────────────────────────────────────────────────────────────────────
export async function buildBillingKpis() {
  const m = await getBillingMetrics();
  return {
    generatedAt: nowStamp(),
    month: m.month,
    facturacionMes: m.facturacionMes,
    cobradoMes: m.cobradoMes,
    pendienteCobro: m.pendienteCobro,
    clientesConAdeudo: m.clientesConAdeudo,
    facturasVencidas: m.facturasVencidas,
    topAdeudos: m.topAdeudos,
  };
}

router.get('/api/dashboard/billing-kpis', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await buildBillingKpis());
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
