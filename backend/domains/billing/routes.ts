import { Router } from 'express';
import { store } from '../../../backend/state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { NotFoundError, asyncHandler } from '../../common/errors';
import { getBillingService } from './service';
import { getBillingCycleService } from './cycle';
import { getCustomersService } from '../customers/service';
import { getPaymentService } from '../payments/service';
import { getSuspensionService } from '../suspension/service';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';

const router = Router();

const WRITE_ROLES: AppRole[] = ['super admin', 'administrador', 'cobranza'];

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/invoices', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getBillingService().listInvoices(tenantIdFromRequest(req)));
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices/:id/account-state
// ────────────────────────────────────────────────────────────────────
router.get(
  '/api/billing/invoices/:id/account-state',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const state = await getBillingService().getAccountState(req.params.id, tenantIdFromRequest(req));
    if (!state) throw new NotFoundError('Invoice ledger not found', 'NOT_FOUND');
    res.json(state);
  }),
);

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/payments  (?customerId=&invoiceId=)
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/payments', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const { customerId, invoiceId } = req.query as Record<string, string | undefined>;
  res.json(await getBillingService().listPayments({
    customerId,
    invoiceId,
    tenantId: tenantIdFromRequest(req),
  }));
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/customers/:customerId/balance
// ────────────────────────────────────────────────────────────────────
router.get(
  '/api/billing/customers/:customerId/balance',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    const fallbackName = isDomainOnDb('billing')
      ? undefined
      : store.CLIENTS.find((c) => c.id === req.params.customerId && (c.tenantId || 'tenant-default') === tenantId)?.name;
    res.json(await getBillingService().getCustomerBalance(req.params.customerId, fallbackName, tenantId));
  }),
);

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices/:id
// (después de las rutas más específicas /invoices/:id/account-state)
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/invoices/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const invoice = await getBillingService().findInvoiceById(req.params.id, tenantIdFromRequest(req));
  if (!invoice) throw new NotFoundError('Invoice not found', 'NOT_FOUND');
  res.json(invoice);
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/account-summary
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/account-summary', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getBillingService().getAccountSummary(tenantIdFromRequest(req)));
}));

// ────────────────────────────────────────────────────────────────────
// GET /api/billing/revenue-report
// ────────────────────────────────────────────────────────────────────
router.get('/api/billing/revenue-report', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getBillingService().getRevenueReport(tenantIdFromRequest(req)));
}));

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/invoices
// ────────────────────────────────────────────────────────────────────
router.post(
  '/api/billing/invoices',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const service = getBillingService();
    const tenantId = tenantIdFromRequest(req);
    const validated = service.validateCreateInvoice(req.body);

    let clientName: string;
    if (!isDomainOnDb('billing')) {
      const client = store.CLIENTS.find(
        (c) => c.id === validated.clientId && (c.tenantId || 'tenant-default') === tenantId,
      );
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      clientName = client.name;
    } else {
      const client = await getCustomersService().getById(validated.clientId, tenantId);
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      clientName = client.name;
    }

    const invoice = await service.createInvoice({
      clientId: validated.clientId,
      clientName,
      amount: validated.amount,
      dueDateStr: validated.dueDateStr,
      items: validated.items,
      tenantId,
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
    const tenantId = tenantIdFromRequest(req);
    const invoice = await service.findInvoiceById(req.params.id, tenantId);
    if (!invoice) throw new NotFoundError('Invoice ledger not found', 'NOT_FOUND');

    const paymentInput = service.validatePayment(invoice, req.body);
    const updated = await service.recordPayment(req.params.id, paymentInput, tenantId);

    if (isDomainOnDb('billing')) {
      const policy = await getSuspensionService().repo.getPolicy();
      if (policy.reactivateOnPayment) {
        const client = await getCustomersService().getById(invoice.clientId, tenantId);
        if (client?.status === 'suspended') {
          await getPaymentService().reactivateCustomerService(invoice.clientId, {
            triggeredBy: req.authContext?.userId,
            invoiceId: invoice.id,
          });
        }
      }
    } else if (!isDomainOnDb('billing')) {
      const client = store.CLIENTS.find(
        (c) => c.id === invoice.clientId && (c.tenantId || 'tenant-default') === tenantId,
      );
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
        // NOTA (PR-1A.2): escritura directa al store en memoria, NO al
        // repositorio. No persiste ni lleva tenant_id ni con USE_DB_CUSTOMERS=true.
        // Se deja así a propósito: toda esta rama muta el store de forma síncrona
        // (status, MIKROTIK_LOGS, createAlert, logSuspensionAction), y persistir
        // solo el timeline dejaría estado medio guardado. Se cierra en PR-3
        // (persistencia completa) junto con el resto del bloque.
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
    const canceled = await getBillingService().cancelInvoice(
      req.params.id,
      reason,
      tenantIdFromRequest(req),
    );
    if (!canceled) throw new NotFoundError('Invoice not found', 'NOT_FOUND');
    res.json(canceled);
  }),
);

// ────────────────────────────────────────────────────────────────────
// POST /api/billing/payments  (registra un pago como recurso)
// ────────────────────────────────────────────────────────────────────
router.post('/api/billing/payments', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const result = await getBillingService().createPayment(req.body || {}, tenantIdFromRequest(req));
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
    const updated = await service.updateInvoice(req.params.id, patch, tenantIdFromRequest(req));
    if (!updated) throw new NotFoundError('Invoice not found', 'NOT_FOUND');
    res.json(updated);
  }),
);

export default router;
