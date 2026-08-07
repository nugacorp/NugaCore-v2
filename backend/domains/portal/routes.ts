import { Router } from 'express';
import { asyncHandler, ForbiddenError, NotFoundError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getBillingService } from '../billing/service';
import { getSupportService } from '../tickets/service';
import { getCollectionsService } from '../collections/service';
import { getCustomersService } from '../customers/service';
import { portalAuthStatus, resolvePortalAuth, type PortalAuthContext } from './auth';

import { getPortalConfig, isPortalFeatureEnabled, updatePortalConfig } from './config-service';
import type { PortalFeatureKey } from './types';
import type { Client } from '../../../src/types';

const router = Router();
const PORTAL_CONFIG_WRITE = ['super admin', 'administrador', 'cobranza'] as const;

const assertPortalFeature = async (tenantId: string, feature: PortalFeatureKey): Promise<void> => {
  if (!(await isPortalFeatureEnabled(tenantId, feature))) {
    throw new ForbiddenError('Función deshabilitada en el portal del cliente', 'PORTAL_FEATURE_DISABLED');
  }
};

/** Staff preview y cliente: getById con tenant → 404 cross-tenant. */
async function loadPortalClient(auth: PortalAuthContext): Promise<Client> {
  const client = await getCustomersService().getById(auth.clientId, auth.tenantId);
  if (!client) throw new NotFoundError('Client not found', 'NOT_FOUND');
  return client;
}

/**
 * Portal cliente — autoservicio.
 * Auth: JWT Supabase (cliente vinculado) | JWT staff (preview) | staging token.
 */
router.get('/api/portal/status', asyncHandler(async (_req, res) => {
  res.json(portalAuthStatus());
}));

router.get('/api/portal/config', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getPortalConfig(tenantIdFromRequest(req)));
}));

router.put('/api/portal/config', requireRoles([...PORTAL_CONFIG_WRITE]), asyncHandler(async (req, res) => {
  res.json(await updatePortalConfig(tenantIdFromRequest(req), { features: req.body?.features }));
}));

router.get('/api/portal/:clientId/summary', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);
  const client = await loadPortalClient(auth);
  const billing = getBillingService();
  const invoices = await billing.listInvoices(auth.tenantId);
  const mine = invoices.filter((i) => i.clientId === client.id && i.status !== 'canceled');
  const pending = mine.filter((i) => i.status !== 'paid');
  const balance = pending.reduce((s, i) => s + (i.pendingAmount ?? i.amount), 0);
  const promises = await getCollectionsService().listPromises({
    clientId: client.id,
    status: 'active',
    tenantId: auth.tenantId,
  });

  const features = (await getPortalConfig(auth.tenantId)).features;
  res.json({
    client: { id: client.id, name: client.name, status: client.status, planId: client.planId },
    balance: features.balance ? balance : 0,
    pendingInvoices: features.invoices ? pending.length : 0,
    nextDue: features.balance
      ? pending.sort((a, b) => String(a.dueDateStr).localeCompare(String(b.dueDateStr)))[0]?.dueDateStr ?? null
      : null,
    activePromises: features.paymentPromise ? promises.length : 0,
    serviceStatus: client.status,
    authMode: auth.mode,
    features,
  });
}));

router.get('/api/portal/:clientId/invoices', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);

  await assertPortalFeature(auth.tenantId, 'invoices');
  const client = await loadPortalClient(auth);
  const invoices = await getBillingService().listInvoices(auth.tenantId);
  res.json(invoices.filter((i) => i.clientId === client.id));
}));

router.get('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);

  await assertPortalFeature(auth.tenantId, 'tickets');
  const client = await loadPortalClient(auth);
  const tickets = await getSupportService().listTickets({ clientId: client.id }, auth.tenantId);
  res.json(tickets);
}));

router.post('/api/portal/:clientId/tickets', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);

  await assertPortalFeature(auth.tenantId, 'reportFailure');
  const client = await loadPortalClient(auth);
  const title = String(req.body?.title || req.body?.subject || 'Reporte portal').trim();
  const ticket = await getSupportService().createTicket({
    clientId: client.id,
    title,
    description: req.body?.description ? String(req.body.description) : undefined,
    category: 'Internet',
    severity: 'medium',
  }, auth.tenantId);
  res.status(201).json({ ok: true, ticket });
}));

router.post('/api/portal/:clientId/payment-promise', asyncHandler(async (req, res) => {
  const auth = await resolvePortalAuth(req);

  await assertPortalFeature(auth.tenantId, 'paymentPromise');
  const client = await loadPortalClient(auth);
  const promise = await getCollectionsService().createPromise({
    clientId: client.id,
    promisedDate: req.body?.promisedDate,
    amount: req.body?.amount,
    notes: 'Solicitud desde portal cliente',
  }, auth.userId, auth.tenantId);
  res.status(201).json(promise);
}));

export default router;
