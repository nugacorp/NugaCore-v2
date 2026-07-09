import { Router } from 'express';
import { store } from '../../state/store';
import { requireAction } from '../../common/rbac';
import { legacyAutomationsDisabled, rejectLegacyAutomations } from './legacy-guard';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const parseTrigger = (value: unknown): 'vencimiento' | 'pago' | 'suspension' | 'alerta' | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'vencimiento') return 'vencimiento';
  if (normalized === 'pago') return 'pago';
  if (normalized === 'suspension') return 'suspension';
  if (normalized === 'alerta') return 'alerta';
  return null;
};

const runOverdueRule = () => {
  let suspended = 0;

  for (const client of store.CLIENTS) {
    if (client.status !== 'active') continue;

    const hasOverdue = store.INVOICES.some((invoice) => invoice.clientId === client.id && invoice.status === 'overdue');
    if (!hasOverdue) continue;

    client.status = 'suspended';
    store.logSuspensionAction({
      clientId: client.id,
      clientName: client.name,
      action: 'suspend',
      reason: 'Regla automatica: cliente con factura vencida detectado por motor de automatizaciones.',
      source: 'automation',
      actorId: 'automation-engine',
    });
    store.createAlert('client', 'warning', client.name, 'Suspension automatica aplicada por vencimiento.');
    suspended += 1;
  }

  return { suspended };
};

const runPaymentRule = () => {
  let reactivated = 0;

  for (const client of store.CLIENTS) {
    if (client.status !== 'suspended') continue;

    const hasOverdue = store.INVOICES.some((invoice) => invoice.clientId === client.id && invoice.status === 'overdue');
    if (hasOverdue) continue;

    client.status = 'active';
    store.logSuspensionAction({
      clientId: client.id,
      clientName: client.name,
      action: 'reactivate',
      reason: 'Regla automatica: cliente regularizado, reactivacion por pago.',
      source: 'automation',
      actorId: 'automation-engine',
    });
    store.createAlert('client', 'info', client.name, 'Reactivacion automatica aplicada por regularizacion de pago.');
    reactivated += 1;
  }

  return { reactivated };
};

const runAlertRule = (threshold = 120) => {
  const recent = store.MONITORING_SNAPSHOTS.slice(0, 50);
  const triggered = recent.filter((row) => row.latencyMs >= threshold || row.status !== 'online');

  triggered.forEach((row) => {
    store.createAlert(
      row.targetType === 'olt' ? 'olt' : 'tower',
      row.status === 'offline' ? 'critical' : 'warning',
      row.targetLabel,
      `[AUTOMATION ALERT] Trigger por regla de latencia/estado. Latencia ${row.latencyMs}ms, perdida ${row.packetLossPct}%.`,
    );
  });

  return { triggeredAlerts: triggered.length, threshold };
};

const runSuspensionRule = () => {
  const suspendedClients = store.CLIENTS.filter((client) => client.status === 'suspended').length;
  if (suspendedClients > 0) {
    store.createAlert('system', 'warning', 'Automation Engine', `Hay ${suspendedClients} clientes suspendidos para seguimiento de cobranza.`);
  }
  return { suspendedClients };
};

router.get('/api/automations/rules', requireAction('automation.manage'), (_req, res) => {
  res.json(store.AUTOMATION_RULES);
});

router.post('/api/automations/rules', requireAction('automation.manage'), (req, res) => {
  const trigger = parseTrigger(req.body.trigger);
  if (!trigger) {
    return res.status(400).json({ error: 'Invalid trigger. Allowed: vencimiento, pago, suspension, alerta.' });
  }

  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Missing required field: name' });
  }

  const newRule = {
    id: store.getUniqueAutomationRuleId(),
    name,
    trigger,
    enabled: req.body.enabled !== undefined ? Boolean(req.body.enabled) : true,
    threshold: req.body.threshold !== undefined ? Number(req.body.threshold) : undefined,
    channels: Array.isArray(req.body.channels) ? req.body.channels.map((c: unknown) => String(c)) : ['dashboard'],
    lastRunAt: undefined,
  };

  store.AUTOMATION_RULES.unshift(newRule);
  res.status(201).json(newRule);
});

router.put('/api/automations/rules/:id', requireAction('automation.manage'), (req, res) => {
  const rule = store.AUTOMATION_RULES.find((row) => row.id === req.params.id);
  if (!rule) {
    return res.status(404).json({ error: 'Automation rule not found' });
  }

  if (req.body.name !== undefined) rule.name = String(req.body.name);
  if (req.body.enabled !== undefined) rule.enabled = Boolean(req.body.enabled);
  if (req.body.threshold !== undefined) rule.threshold = Number(req.body.threshold);
  if (req.body.channels !== undefined) {
    if (!Array.isArray(req.body.channels)) {
      return res.status(400).json({ error: 'channels must be an array of strings' });
    }
    rule.channels = req.body.channels.map((c: unknown) => String(c));
  }
  if (req.body.trigger !== undefined) {
    const parsedTrigger = parseTrigger(req.body.trigger);
    if (!parsedTrigger) {
      return res.status(400).json({ error: 'Invalid trigger. Allowed: vencimiento, pago, suspension, alerta.' });
    }
    rule.trigger = parsedTrigger;
  }

  res.json(rule);
});

router.delete('/api/automations/rules/:id', requireAction('automation.manage'), (req, res) => {
  const exists = store.AUTOMATION_RULES.some((row) => row.id === req.params.id);
  if (!exists) {
    return res.status(404).json({ error: 'Automation rule not found' });
  }
  store.AUTOMATION_RULES = store.AUTOMATION_RULES.filter((row) => row.id !== req.params.id);
  res.status(204).send();
});

router.post('/api/automations/run', requireAction('automation.execute'), (req, res) => {
  if (legacyAutomationsDisabled()) return rejectLegacyAutomations(res);
  const trigger = req.body.trigger ? parseTrigger(req.body.trigger) : null;
  const rules = store.AUTOMATION_RULES.filter((rule) => rule.enabled && (!trigger || rule.trigger === trigger));

  const results: Array<{ ruleId: string; trigger: string; output: Record<string, unknown> }> = [];

  for (const rule of rules) {
    let output: Record<string, unknown> = {};

    if (rule.trigger === 'vencimiento') {
      output = runOverdueRule();
    } else if (rule.trigger === 'pago') {
      output = runPaymentRule();
    } else if (rule.trigger === 'suspension') {
      output = runSuspensionRule();
    } else if (rule.trigger === 'alerta') {
      output = runAlertRule(rule.threshold || 120);
    }

    rule.lastRunAt = nowStamp();
    results.push({ ruleId: rule.id, trigger: rule.trigger, output });
  }

  res.json({
    executedAt: nowStamp(),
    trigger: trigger || 'all',
    executedRules: results.length,
    results,
  });
});

export default router;
