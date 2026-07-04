import { Router } from 'express';
import { store } from '../../../backend/state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { NotFoundError, asyncHandler } from '../../common/errors';
import { getBillingService } from './service';
import { getBillingCycleService } from './cycle';

const router = Router();

const WRITE_ROLES: AppRole[] = ['super admin', 'administrador', 'cobranza'];

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/invoices', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getBillingService().listInvoices());
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices/:id/account-state
// ────────────────────────────────────────────────────────────────────
router.get(
  '/api/billing/invoices/:id/account-state',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const state = await getBillingService().getAccountState(req.params.id);
    if (!state) throw new NotFoundError('Invoice ledger not found', 'NOT_FOUND');
    res.json(state);
  }),
);

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/payments  (?customerId=&invoiceId=)
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/payments', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const { customerId, invoiceId } = req.query as Record<string, string | undefined>;
  res.json(await getBillingService().listPayments({ customerId, invoiceId }));
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/customers/:customerId/balance
// ────────────────────────────────────────────────────────────────────
router.get(
  '/api/billing/customers/:customerId/balance',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const fallbackName = isDomainOnDb('billing')
      ? undefined
      : store.CLIENTS.find((c) => c.id === req.params.customerId)?.name;
    res.json(await getBillingService().getCustomerBalance(req.params.customerId, fallbackName));
  }),
);

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices/:id
// (después de las rutas más específicas /invoices/:id/account-state)
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/invoices/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const invoice = await getBillingService().findInvoiceById(req.params.id);
  if (!invoice) throw new NotFoundError('Invoice not found', 'NOT_FOUND');
  res.json(invoice);
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/account-summary
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/account-summary', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getBillingService().getAccountSummary());
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/revenue-report
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/revenue-report', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getBillingService().getRevenueReport());
}));

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/invoices
// ────────────────────────────────────────────────────────────────────
router.post(
  '/api/billing/invoices',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const service = getBillingService();
    const validated = service.validateCreateInvoice(req.body);

    let clientName: string;
    if (!isDomainOnDb('billing')) {
      const client = store.CLIENTS.find((c) => c.id === validated.clientId);
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      clientName = client.name;
    } else {
      // En modo DB se puede pasar clientName en el body, o se buscará desde clients
      clientName =
        typeof req.body.clientName === 'string' && req.body.clientName.trim()
          ? req.body.clientName.trim()
          : validated.clientId;
    }

    const invoice = await service.createInvoice({
      clientId: validated.clientId,
      clientName,
      amount: validated.amount,
      dueDateStr: validated.dueDateStr,
      items: validated.items,
    });
    res.status(201).json(invoice);
  }),
);

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/invoices/:id/pay
// ────────────────────────────────────────────────────────────────────
router.post(
  '/api/billing/invoices/:id/pay',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const service = getBillingService();
    const invoice = await service.findInvoiceById(req.params.id);
    if (!invoice) throw new NotFoundError('Invoice ledger not found', 'NOT_FOUND');

    const paymentInput = service.validatePayment(invoice, req.body);
    const updated = await service.recordPayment(req.params.id, paymentInput);

    // ── Reactivación automática al pagar (solo modo mock) ────────────
    // En modo DB se implementará en Fase 4.5 junto con el dominio Suspension.
    if (!isDomainOnDb('billing')) {
      const client = store.CLIENTS.find((c) => c.id === invoice.clientId);
      if (client && client.status === 'suspended' && store.SUSPENSION_POLICY.allowAutoReactivateOnPayment) {
        client.status = 'active';
        store.MIKROTIK_LOGS.push({
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          message: `script,info Automations Flow: billing payment success of ${invoice.id} triggers reactivate customer state for ${client.pppoeUser}`,
        });
        store.createAlert('client', 'info', client.name, `Pago recibido via ${paymentInput.method}. Cuenta reactivada automaticamente a velocidad completa.`);
        store.logSuspensionAction({
          clientId: client.id,
          clientName: client.name,
          action: 'reactivate',
          reason: `Pago conciliado en factura ${invoice.id}.`,
          source: 'automation',
          actorId: req.authContext?.userId,
        });
        store.addClientTimelineEvent({
          clientId: client.id,
          eventType: 'status_change',
          summary: 'Cambio de estatus suspended -> active',
          details: `Reactivacion automatica posterior al pago de factura ${invoice.id}.`,
          createdBy: req.authContext?.userId,
        });
      }
    }

    res.json(updated);
  }),
);

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/invoices/:id/cancel
// ────────────────────────────────────────────────────────────────────
router.post(
  '/api/billing/invoices/:id/cancel',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
    const canceled = await getBillingService().cancelInvoice(req.params.id, reason);
    if (!canceled) throw new NotFoundError('Invoice not found', 'NOT_FOUND');
    res.json(canceled);
  }),
);

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/payments  (registra un pago como recurso)
// ────────────────────────────────────────────────────────────────────
router.post('/api/billing/payments', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const result = await getBillingService().createPayment(req.body || {});
  res.status(201).json(result);
}));

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/run-cycle  (FASE C — simulación de facturación)
// ────────────────────────────────────────────────────────────────────
router.post('/api/billing/run-cycle', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const result = await getBillingCycleService().runCycle(req.body || {});
  res.json(result);
}));

// ────────────────────────────────────────────────────────────────────
// PUT /api/billing/invoices/:id
// ────────────────────────────────────────────────────────────────────
router.put(
  '/api/billing/invoices/:id',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const service = getBillingService();
    const patch = service.validateUpdateInvoice(req.body);
    const updated = await service.updateInvoice(req.params.id, patch);
    if (!updated) throw new NotFoundError('Invoice not found', 'NOT_FOUND');
    res.json(updated);
  }),
);

export default router;
