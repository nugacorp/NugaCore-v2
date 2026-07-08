import { Router } from 'express';
import { asyncHandler, NotFoundError, UnauthorizedError } from '../../common/errors';
import { getBillingService } from '../billing/service';
import { getSupportService } from '../tickets/service';
import { getCollectionsService } from '../collections/service';
import { getCustomersService } from '../customers/service';

const router = Router();

const portalTokenConfigured = () => {
  const token = (process.env.PORTAL_STAGING_TOKEN || '').trim();
  return token.length > 0;
};

function assertPortalAccess(req: { headers: Record<string, string | string[] | undefined> }) {
  const expected = (process.env.PORTAL_STAGING_TOKEN || '').trim();
  if (!expected) return;
  const provided = String(req.headers['x-portal-token'] || '').trim();
  if (provided !== expected) {
    throw new UnauthorizedError('Invalid portal token', 'PORTAL_UNAUTHORIZED');
  }
}

/**
 * Portal cliente — autoservicio (staging: x-portal-client-id o :clientId en ruta).
 * Producción: JWT Supabase rol Cliente.
 */
async function resolvePortalClient(req: { params: { clientId?: string }; headers: Record<string, string | string[] | undefined> }) {
  const clientId = String(req.params.clientId || req.headers['x-portal-client-id'] || '').trim();
  if (!clientId) return null;
  return getCustomersService().getById(clientId);
}

router.get('/api/portal/status', asyncHandler(async (_req, res) => {
  res.json({
    mode: portalTokenConfigured() ? 'staging-token' : 'open',
    authRequired: portalTokenConfigured(),
    note: portalTokenConfigured()
      ? 'Enviar x-portal-token en requests de portal'
      : 'Staging abierto — configurar PORTAL_STAGING_TOKEN en producción',
  });
}));

router.get('/api/portal/:clientId/summary', asyncHandler(async (req, res) => {
  assertPortalAccess(req);
  const client = await resolvePortalClient(req);
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
  assertPortalAccess(req);
  const client = await resolvePortalClient(req);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const invoices = await getBillingService().listInvoices();
  res.json(invoices.filter((i) => i.clientId === client.id));
}));

router.get('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  assertPortalAccess(req);
  const client = await resolvePortalClient(req);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  const tickets = await getSupportService().listTickets({ clientId: client.id });
  res.json(tickets);
}));

router.post('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  assertPortalAccess(req);
  const client = await resolvePortalClient(req);
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
  assertPortalAccess(req);
  const client = await resolvePortalClient(req);
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
