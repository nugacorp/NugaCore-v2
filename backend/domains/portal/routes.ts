import { Router } from 'express';
import { asyncHandler, NotFoundError } from '../../common/errors';
import { getBillingService } from '../billing/service';
import { getSupportService } from '../tickets/service';
import { getCollectionsService } from '../collections/service';
import { store } from '../../state/store';

const router = Router();

/**
 * Portal cliente — endpoints de autoservicio (auth por clientId + portal token simple).
 * En producción: JWT Supabase por rol Cliente.
 */
function resolvePortalClient(req: { params: { clientId?: string }; headers: Record<string, string | string[] | undefined> }) {
  const clientId = String(req.params.clientId || req.headers['x-portal-client-id'] || '').trim();
  if (!clientId) return null;
  return store.CLIENTS.find((c) => c.id === clientId) ?? null;
}

router.get('/api/portal/:clientId/summary', asyncHandler(async (req, res) => {
  const client = resolvePortalClient(req);
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
  });
}));

router.get('/api/portal/:clientId/invoices', asyncHandler(async (req, res) => {
  const client = resolvePortalClient(req);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const invoices = await getBillingService().listInvoices();
  res.json(invoices.filter((i) => i.clientId === client.id));
}));

router.post('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  const client = resolvePortalClient(req);
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
  const client = resolvePortalClient(req);
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
