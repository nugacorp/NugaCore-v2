import { Router } from 'express';
import { store } from '../../state/store';
import { requireRoles } from '../../common/rbac';
import { getSuspensionService } from './service';
import { asyncHandler } from '../../common/errors';
import {
  customerServiceView,
  evaluateAllCustomers,
  evaluateCustomerById,
} from './engine';
import { SuspensionPolicyV2 } from './types';
import { getCustomersService } from '../customers/service';
import { getBillingService } from '../billing/service';
import { isDomainOnDb } from '../../config/feature-flags';
import { supabaseAdmin } from '../../services/supabase-admin';
import type { Client } from '../../../src/types';

const router = Router();

// RBAC del Motor de Suspensiones (Fase 4.5)
const SUSP_VIEW_ROLES = ['super admin', 'administrador', 'cobranza', 'tecnico', 'solo lectura'] as const;
const SUSP_EVALUATE_ROLES = ['super admin', 'administrador', 'cobranza'] as const;
const SUSP_POLICY_ROLES = ['super admin', 'administrador'] as const;

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

// ════════════════════════════════════════════════════════════════════
// MOTOR DE SUSPENSIONES (Fase 4.5) — decide y emite ÓRDENES. No ejecuta.
// ════════════════════════════════════════════════════════════════════

// ── Políticas ─────────────────────────────────────────────────────────
router.get('/api/suspension/policies', requireRoles([...SUSP_VIEW_ROLES]), asyncHandler(async (_req, res) => {
  res.json(await getSuspensionService().repo.getPolicy());
}));

router.put('/api/suspension/policies', requireRoles([...SUSP_POLICY_ROLES]), asyncHandler(async (req, res) => {
  const repo = getSuspensionService().repo;
  const p = await repo.getPolicy();
  const body = req.body || {};
  const next: SuspensionPolicyV2 = { ...p };

  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.suspendAfterDue !== undefined) next.suspendAfterDue = Boolean(body.suspendAfterDue);
  if (body.reactivateOnPayment !== undefined) next.reactivateOnPayment = Boolean(body.reactivateOnPayment);
  if (body.reactivateOnPartialPayment !== undefined) next.reactivateOnPartialPayment = Boolean(body.reactivateOnPartialPayment);
  if (body.autoReactivate !== undefined) next.autoReactivate = Boolean(body.autoReactivate);
  if (body.name !== undefined) next.name = String(body.name);

  if (body.graceDays !== undefined) {
    const g = Number(body.graceDays);
    if (!Number.isFinite(g) || g < 0 || g > 60) {
      res.status(400).json({ error: 'Invalid graceDays. Allowed range: 0 to 60.' });
      return;
    }
    next.graceDays = g;
  }
  if (body.dueSoonDays !== undefined) {
    const d = Number(body.dueSoonDays);
    if (!Number.isFinite(d) || d < 0 || d > 30) {
      res.status(400).json({ error: 'Invalid dueSoonDays. Allowed range: 0 to 30.' });
      return;
    }
    next.dueSoonDays = d;
  }

  next.updatedAt = new Date().toISOString();
  res.json(await repo.savePolicy(next));
}));

// ── Estado de clientes (read-only) ────────────────────────────────────
router.get('/api/suspension/customers', requireRoles([...SUSP_VIEW_ROLES]), asyncHandler(async (_req, res) => {
  res.json(await customerServiceView());
}));

// ── Órdenes ───────────────────────────────────────────────────────────
router.get('/api/suspension/orders', requireRoles([...SUSP_VIEW_ROLES]), asyncHandler(async (req, res) => {
  const status = String(req.query.status || '').trim().toUpperCase();
  const customerId = String(req.query.customerId || '').trim();
  const rows = await getSuspensionService().repo.listOrders({
    customerId: customerId || undefined,
    status: status || undefined,
  });
  res.json(rows);
}));

// ── Eventos / auditoría ───────────────────────────────────────────────
router.get('/api/suspension/events', requireRoles([...SUSP_VIEW_ROLES]), asyncHandler(async (req, res) => {
  const customerId = String(req.query.customerId || '').trim();
  res.json(await getSuspensionService().repo.listEvents(customerId || undefined));
}));

// ── Evaluación (genera órdenes; NO ejecuta) ───────────────────────────
router.post('/api/suspension/evaluate/:customerId', requireRoles([...SUSP_EVALUATE_ROLES]), asyncHandler(async (req, res) => {
  const result = await evaluateCustomerById(req.params.customerId, req.authContext?.userId);
  if (!result) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  res.json(result);
}));

router.post('/api/suspension/evaluate-all', requireRoles([...SUSP_EVALUATE_ROLES]), asyncHandler(async (req, res) => {
  const results = await evaluateAllCustomers(req.authContext?.userId);
  const summary = {
    evaluated: results.length,
    suspensionOrders: results.filter((r) => r.action === 'create_suspension').length,
    reactivationOrders: results.filter((r) => r.action === 'create_reactivation').length,
    changed: results.filter((r) => r.changed).length,
  };
  res.json({ summary, results });
}));

// ════════════════════════════════════════════════════════════════════
// HERRAMIENTA DE STAGING/TEST (Fase 4.5.1) — crea escenarios A/B usando los
// services REALES de Customers/Billing, para que Hermes valide end-to-end
// también con USE_DB_CUSTOMERS/USE_DB_BILLING=true.
//
// Triple candado (NUNCA disponible en producción):
//   - NODE_ENV !== 'production'
//   - STAGING_TEST_TOOLS_ENABLED !== 'false'
//   - rol super admin + body.confirm === true
// ════════════════════════════════════════════════════════════════════
const testToolsAvailable = (): boolean =>
  (process.env.NODE_ENV || 'development') !== 'production' &&
  (process.env.STAGING_TEST_TOOLS_ENABLED || 'true').trim().toLowerCase() !== 'false';

const daysAgo = (n: number): string => new Date(Date.now() - n * 86400000).toISOString().substring(0, 10);

router.post('/api/suspension/test-tools/scenario', requireRoles(['super admin']), asyncHandler(async (req, res) => {
  if (!testToolsAvailable()) {
    res.status(404).json({ error: 'Test tools not available in this environment.' });
    return;
  }
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: 'Confirmation required: send { "confirm": true }.' });
    return;
  }
  const scenario = String(req.body?.scenario || '').toUpperCase();
  if (scenario !== 'A' && scenario !== 'B') {
    res.status(400).json({ error: 'scenario must be "A" (suspend) or "B" (reactivate).' });
    return;
  }

  const customers = getCustomersService();
  const billing = getBillingService();
  const planId = String(req.body?.planId || 'plan-basic');
  const amount = Number(req.body?.amount) || 449;

  // 1. Cliente de prueba (status según escenario).
  const clientId = await customers.generateClientId();
  const networkStatus: Client['status'] = scenario === 'B' ? 'suspended' : 'active';
  const client: Client = {
    id: clientId,
    name: `__TEST__ Suspension ${scenario} ${clientId}`,
    type: 'residential',
    status: networkStatus,
    email: `test_${clientId}@example.com`,
    phone: '0000000000',
    address: 'Test', city: 'Test', lat: 0, lng: 0,
    planId, ip: '10.255.255.1',
    pppoeUser: `test_${clientId}`,
  };
  await customers.create(client);

  // 2. Factura vencida (fuera de la gracia).
  const invoice = await billing.createInvoice({
    clientId,
    clientName: client.name,
    amount,
    dueDateStr: daysAgo(15),
    items: [{ description: '__TEST__ Suscripción', price: amount, qty: 1 }],
  });

  // 3. Escenario B: pago COMPLETO → factura cerrada → procede reactivación.
  if (scenario === 'B') {
    await billing.recordPayment(invoice.id, { amount, method: 'SPEI', transactionId: `TEST_${clientId}` });
  }

  res.status(201).json({
    scenario,
    customerId: clientId,
    invoiceId: invoice.id,
    networkStatus,
    expectation: scenario === 'A'
      ? 'Cliente activo + factura vencida fuera de gracia → al evaluar se crea SuspensionOrder.'
      : 'Cliente suspendido + factura pagada → al evaluar se crea ReactivationOrder.',
    next: `POST /api/suspension/evaluate/${clientId}`,
  });
}));

// Solo limpia clientes creados por test-tools (prefijo en el nombre).
const TEST_CUSTOMER_PREFIX = '__TEST__';

// Purga la cadena de Billing del cliente en el ORDEN de FK correcto.
// (payments.client_id y payment_applications.* son ON DELETE RESTRICT, por
//  eso borrar el cliente directo daba 500.) Idempotente.
async function purgeBillingForCustomer(customerId: string): Promise<void> {
  if (isDomainOnDb('billing') && supabaseAdmin) {
    const { data: invs } = await supabaseAdmin.from('invoices').select('id').eq('client_id', customerId);
    const invoiceIds = (invs || []).map((r: { id: string }) => r.id);
    const { data: pays } = await supabaseAdmin.from('payments').select('id').eq('client_id', customerId);
    const paymentIds = (pays || []).map((r: { id: string }) => r.id);

    if (invoiceIds.length) await supabaseAdmin.from('payment_applications').delete().in('invoice_id', invoiceIds);
    if (paymentIds.length) await supabaseAdmin.from('payment_applications').delete().in('payment_id', paymentIds);
    await supabaseAdmin.from('payments').delete().eq('client_id', customerId);
    if (invoiceIds.length) await supabaseAdmin.from('invoice_items').delete().in('invoice_id', invoiceIds);
    await supabaseAdmin.from('invoices').delete().eq('client_id', customerId);
    return;
  }

  // Modo mock: limpia el store en memoria.
  const invoiceIds = new Set(store.INVOICES.filter((i) => i.clientId === customerId).map((i) => i.id));
  store.PAYMENT_ALLOCATIONS = store.PAYMENT_ALLOCATIONS.filter((a) => !invoiceIds.has(a.invoiceId));
  store.INVOICES = store.INVOICES.filter((i) => i.clientId !== customerId);
}

router.delete('/api/suspension/test-tools/customer/:id', requireRoles(['super admin']), asyncHandler(async (req, res) => {
  if (!testToolsAvailable()) {
    res.status(404).json({ error: 'Test tools not available in this environment.' });
    return;
  }
  const customerId = req.params.id;
  const customer = await getCustomersService().getById(customerId);

  // Idempotente: si ya no existe, respuesta controlada (no 500).
  if (!customer) {
    res.json({ removed: false, customerId, reason: 'not_found' });
    return;
  }
  // Candado: SOLO clientes de prueba; nunca clientes reales.
  if (!customer.name.startsWith(TEST_CUSTOMER_PREFIX)) {
    res.status(403).json({ error: 'Refusing to delete a non-test customer.' });
    return;
  }

  // Orden de borrado (hijos → padre):
  // 1. payment_applications  2. payments  3. invoice_items  4. invoices
  await purgeBillingForCustomer(customerId);
  // 5-8. órdenes / eventos / estado del motor
  await getSuspensionService().repo.purgeCustomer(customerId);
  // 9. cliente
  const removed = await getCustomersService().remove(customerId);

  res.json({ removed, customerId, cleaned: ['billing', 'suspension', 'customer'] });
}));

export default router;
