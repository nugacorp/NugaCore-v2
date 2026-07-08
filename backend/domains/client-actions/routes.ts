import { Router } from 'express';
import { asyncHandler, BadRequestError, NotFoundError } from '../../common/errors';
import { requireRoles } from '../../common/rbac';
import { getBillingService } from '../billing/service';
import { getCustomersService } from '../customers/service';
import { getSupportService } from '../tickets/service';

const router = Router();
const WRITE = ['super admin', 'administrador', 'cobranza', 'soporte'] as const;

/**
 * Puente Client 360 → backends reales con gates de seguridad.
 * No ejecuta RouterOS ni suspension live; delega a dominios existentes.
 */

router.post('/api/client-actions/:clientId/payment', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const clientId = req.params.clientId;
  const client = await getCustomersService().getById(clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestError('Invalid amount', 'INVALID_FIELD');
  }
  const billing = getBillingService();
  const invoices = await billing.listInvoices();
  const invoice = invoices.find(
    (i) => i.clientId === clientId && i.status !== 'paid' && i.status !== 'canceled',
  );
  if (!invoice) {
    throw new BadRequestError('No pending invoice for client', 'NO_INVOICE');
  }
  const result = await billing.createPayment({
    invoiceId: invoice.id,
    amount,
    paymentMethod: req.body?.paymentMethod ? String(req.body.paymentMethod) : 'Efectivo',
    reference: req.body?.reference ? String(req.body.reference) : `client360-${Date.now()}`,
  });
  res.status(201).json({ ok: true, payment: result.payment, invoice: result.invoice, source: 'billing' });
}));

router.post('/api/client-actions/:clientId/ticket', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const clientId = req.params.clientId;
  const client = await getCustomersService().getById(clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const title = String(req.body?.title || req.body?.subject || '').trim();
  if (!title) throw new BadRequestError('Missing title/subject', 'MISSING_FIELD');
  const ticket = await getSupportService().createTicket({
    clientId,
    title,
    description: req.body?.description ? String(req.body.description) : undefined,
    category: req.body?.category,
    severity: req.body?.severity,
    priority: req.body?.priority,
  });
  res.status(201).json({ ok: true, ticket, source: 'support' });
}));

router.post('/api/client-actions/:clientId/work-order', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const clientId = req.params.clientId;
  const date = String(req.body?.date || new Date().toISOString().substring(0, 10));
  const order = await getSupportService().createWorkOrder({
    title: String(req.body?.title || 'Instalación Client 360'),
    clientId,
    date,
    type: req.body?.type,
    notes: req.body?.notes ? String(req.body.notes) : undefined,
    technicianName: req.body?.technicianName ? String(req.body.technicianName) : undefined,
  });
  res.status(201).json({ ok: true, workOrder: order, source: 'support' });
}));

export default router;
