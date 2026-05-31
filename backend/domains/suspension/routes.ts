import { Router } from 'express';
import { store } from '../../state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

const toMsDays = (days: number): number => days * 24 * 60 * 60 * 1000;

const findClientById = (clientId: string) => store.CLIENTS.find((client) => client.id === clientId);

const hasOverdueBalanceBeyondGrace = (clientId: string): boolean => {
  const now = Date.now();
  const graceLimitMs = toMsDays(store.SUSPENSION_POLICY.graceDays);
  return store.INVOICES.some((invoice) => {
    if (invoice.clientId !== clientId) return false;
    if (invoice.status !== 'overdue') return false;
    const dueMs = new Date(invoice.dueDateStr).getTime();
    if (!Number.isFinite(dueMs)) return false;
    return now - dueMs >= graceLimitMs;
  });
};

const suspendClient = (clientId: string, reason: string, source: 'manual' | 'automation', actorId?: string) => {
  const client = findClientById(clientId);
  if (!client) return null;
  if (client.status === 'suspended') return client;

  client.status = 'suspended';
  store.MIKROTIK_LOGS.push({
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    message: `script,info Core Router Suspended PPPoE: ${client.pppoeUser || client.id} block address list active`,
  });
  store.createAlert('client', 'warning', client.name, 'Linea suspendida por politica de cobranza simulada.');
  store.addClientTimelineEvent({
    clientId: client.id,
    eventType: 'status_change',
    summary: 'Cambio de estatus active -> suspended',
    details: reason,
    createdBy: actorId,
  });
  store.logSuspensionAction({
    clientId: client.id,
    clientName: client.name,
    action: 'suspend',
    reason,
    source,
    actorId,
  });

  return client;
};

const reactivateClient = (clientId: string, reason: string, source: 'manual' | 'automation', actorId?: string) => {
  const client = findClientById(clientId);
  if (!client) return null;
  if (client.status === 'active') return client;

  client.status = 'active';
  store.MIKROTIK_LOGS.push({
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    message: `script,info Core Router Reactivated PPPoE: ${client.pppoeUser || client.id} unblocked address list`,
  });
  store.createAlert('client', 'info', client.name, 'Linea reactivada por flujo simulado de cobranza.');
  store.addClientTimelineEvent({
    clientId: client.id,
    eventType: 'status_change',
    summary: 'Cambio de estatus suspended -> active',
    details: reason,
    createdBy: actorId,
  });
  store.logSuspensionAction({
    clientId: client.id,
    clientName: client.name,
    action: 'reactivate',
    reason,
    source,
    actorId,
  });

  return client;
};

router.get('/api/suspension/policy', (_req, res) => {
  res.json(store.SUSPENSION_POLICY);
});

router.put('/api/suspension/policy', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const { enabled, graceDays, allowAutoReactivateOnPayment } = req.body;

  if (enabled !== undefined) {
    store.SUSPENSION_POLICY.enabled = Boolean(enabled);
  }

  if (graceDays !== undefined) {
    const parsed = Number(graceDays);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 30) {
      return res.status(400).json({ error: 'Invalid graceDays. Allowed range: 0 to 30.' });
    }
    store.SUSPENSION_POLICY.graceDays = parsed;
  }

  if (allowAutoReactivateOnPayment !== undefined) {
    store.SUSPENSION_POLICY.allowAutoReactivateOnPayment = Boolean(allowAutoReactivateOnPayment);
  }

  res.json(store.SUSPENSION_POLICY);
});

router.get('/api/suspension/logs', (req, res) => {
  const clientId = String(req.query.clientId || '').trim();
  const filtered = clientId
    ? store.SUSPENSION_ACTION_LOGS.filter((event) => event.clientId === clientId)
    : store.SUSPENSION_ACTION_LOGS;
  res.json(filtered);
});

router.post('/api/suspension/run', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  if (!store.SUSPENSION_POLICY.enabled) {
    return res.json({
      policyEnabled: false,
      suspended: 0,
      reactivated: 0,
      details: [],
      message: 'Suspension policy is disabled.',
    });
  }

  const actorId = req.authContext?.userId;
  const details: Array<{ clientId: string; action: 'suspend' | 'reactivate'; reason: string }> = [];

  for (const client of store.CLIENTS) {
    if (client.status === 'lead' || client.status === 'baja') continue;

    const mustSuspend = hasOverdueBalanceBeyondGrace(client.id);
    const hasOpenOverdue = store.INVOICES.some((invoice) => invoice.clientId === client.id && invoice.status === 'overdue');

    if (mustSuspend && client.status !== 'suspended') {
      const reason = `Regla automatica: morosidad vencida sobre ventana de gracia (${store.SUSPENSION_POLICY.graceDays} dias).`;
      suspendClient(client.id, reason, 'automation', actorId);
      details.push({ clientId: client.id, action: 'suspend', reason });
      continue;
    }

    if (
      store.SUSPENSION_POLICY.allowAutoReactivateOnPayment &&
      !hasOpenOverdue &&
      client.status === 'suspended'
    ) {
      const reason = 'Regla automatica: saldo vencido regularizado, se reactiva servicio.';
      reactivateClient(client.id, reason, 'automation', actorId);
      details.push({ clientId: client.id, action: 'reactivate', reason });
    }
  }

  store.logSuspensionAction({
    clientId: 'system',
    clientName: 'System Rule Engine',
    action: 'rule-scan',
    reason: `Ejecucion de regla: ${details.length} acciones aplicadas.`,
    source: 'automation',
    actorId,
  });

  res.json({
    policyEnabled: true,
    suspended: details.filter((event) => event.action === 'suspend').length,
    reactivated: details.filter((event) => event.action === 'reactivate').length,
    details,
  });
});

router.post('/api/suspension/clients/:id/suspend', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const clientId = req.params.id;
  const reason = String(req.body.reason || 'Suspension manual solicitada por operacion.');
  const client = suspendClient(clientId, reason, 'manual', req.authContext?.userId);

  if (!client) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json(client);
});

router.post('/api/suspension/clients/:id/reactivate', requireRoles(['super admin', 'administrador', 'cobranza']), (req, res) => {
  const clientId = req.params.id;
  const reason = String(req.body.reason || 'Reactivacion manual solicitada por operacion.');
  const client = reactivateClient(clientId, reason, 'manual', req.authContext?.userId);

  if (!client) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json(client);
});

export default router;
