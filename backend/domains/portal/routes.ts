import { Router } from 'express';
import { asyncHandler, NotFoundError } from '../../common/errors';
import { getBillingService } from '../billing/service';
import { getSupportService } from '../tickets/service';
import { getCollectionsService } from '../collections/service';
import { getCustomersService } from '../customers/service';
import { portalAuthStatus, resolvePortalAuth } from './auth';

const router = Router();

/**
 * Portal cliente — autoservicio.
 * Auth: JWT Supabase (cliente vinculado) | JWT staff (preview) | staging token.
 */
router.get('/api/portal/status', asyncHandler(async (_req, res) => {
  res.json(portalAuthStatus());
}));

router.get('/api/portal/:clientId/summary', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);
  const client = await getCustomersService().getById(auth.clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const billing = getBillingService();
  const invoices = await billing.listInvoices();
  const mine = invoices.filter((i) => i.clientId === client.id && i.status !== 'canceled');
  const pending = mine.filter((i) => i.status !== 'paid');
  const balance = pending.reduce((s, i) => s + (i.pendingAmount ?? i.amount), 0);
  const promises = await getCollectionsService().listPromises({ clientId: client.id, status: 'active' });
  res.json({
    client: { id: client.id, name: client.name, status: client.status, planId: client.planId },
    balance,
    pendingInvoices: pending.length,
    nextDue: pending.sort((a, b) => String(a.dueDateStr).localeCompare(String(b.dueDateStr)))[0]?.dueDateStr ?? null,
    activePromises: promises.length,
    serviceStatus: client.status,
    authMode: auth.mode,
  });
}));

router.get('/api/portal/:clientId/invoices', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);
  const client = await getCustomersService().getById(auth.clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const invoices = await getBillingService().listInvoices();
  res.json(invoices.filter((i) => i.clientId === client.id));
}));

router.get('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);
  const client = await getCustomersService().getById(auth.clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const tickets = await getSupportService().listTickets({ clientId: client.id });
  res.json(tickets);
}));

router.post('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);
  const client = await getCustomersService().getById(auth.clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const title = String(req.body?.title || req.body?.subject || 'Reporte portal').trim();
  const ticket = await getSupportService().createTicket({
    clientId: client.id,
    title,
    description: req.body?.description ? String(req.body.description) : undefined,
    category: 'Internet',
    severity: 'medium',
  });
  res.status(201).json({ ok: true, ticket });
}));

router.post('/api/portal/:clientId/payment-promise', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);
  const client = await getCustomersService().getById(auth.clientId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const promise = await getCollectionsService().createPromise({
    clientId: client.id,
    promisedDate: req.body?.promisedDate,
    amount: req.body?.amount,
    notes: 'Solicitud desde portal cliente',
  });
  res.status(201).json(promise);
}));

export default router;
