import { Router } from 'express';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

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

router.get('/api/dashboard-stats', (_req, res) => {
  const activeCount = store.CLIENTS.filter((c) => c.status === 'active').length;
  const suspendedCount = store.CLIENTS.filter((c) => c.status === 'suspended').length;
  const leadsCount = store.CLIENTS.filter((c) => c.status === 'lead').length;
  const totalMrr = store.CLIENTS.reduce((acc, c) => {
    if (c.status === 'active' || c.status === 'suspended') {
      const plan = store.PLANS.find((p) => p.id === c.planId);
      return acc + (plan ? plan.price : 0);
    }
    return acc;
  }, 0);

  const monthCobranza = store.INVOICES.filter((f) => f.status === 'paid').reduce((acc, f) => acc + f.amount, 0);
  const monthFacturacion = store.INVOICES.reduce((acc, f) => acc + f.amount, 0);

  const onlineTowers = store.TOWERS.filter((t) => t.status === 'online').length;
  const warningsTowers = store.TOWERS.filter((t) => t.status === 'warning').length;
  const offlineTowers = store.TOWERS.filter((t) => t.status === 'offline').length;

  res.json({
    activeClients: activeCount,
    suspendedClients: suspendedCount,
    leadsCount,
    mrr: totalMrr,
    cobranzaMes: monthCobranza,
    facturacionMes: monthFacturacion,
    activeTickets: store.TICKETS.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length,
    towers: { online: onlineTowers, warning: warningsTowers, offline: offlineTowers },
    oltStats: { connected: store.ONUS.filter((o) => o.status === 'online').length, offlineOnus: store.ONUS.filter((o) => o.status !== 'online').length },
  });
});

router.get('/api/notifications/settings', (_req, res) => {
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

router.get('/api/alerts', (_req, res) => res.json(store.NOC_ALERTS));

router.get('/api/monitoring/overview', (_req, res) => {
  res.json(calculateMonitoringOverview());
});

router.get('/api/monitoring/snapshots', (req, res) => {
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

router.get('/api/monitoring/targets', (_req, res) => {
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
