import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getIntegrationsService } from './service';
import type { IntegrationProviderKey } from './types';

const router = Router();
const WRITE = ['super admin', 'administrador'] as const;

router.get('/api/integrations/settings', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getIntegrationsService().getSettingsView());
}));

router.put('/api/integrations/settings', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const body = req.body || {};
  res.json(
    await getIntegrationsService().updateSettings({
      stripe: body.stripe,
      whatsapp: body.whatsapp,
      telegram: body.telegram,
      codi: body.codi,
      openpay: body.openpay,
    }),
  );
}));

router.post('/api/integrations/test/:provider', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const provider = String(req.params.provider).toLowerCase() as IntegrationProviderKey;
  res.json(await getIntegrationsService().testProvider(provider));
}));

router.post('/api/billing/invoices/:id/notify', requireRoles([...WRITE, 'cobranza']), asyncHandler(async (req, res) => {
  res.json(await getIntegrationsService().notifyInvoice(req.params.id));
}));

router.post('/api/payments/webhook/codi', asyncHandler(async (req, res) => {
  const signature = String(req.headers['x-codi-signature'] || req.headers['x-webhook-secret'] || '');
  const result = await getIntegrationsService().processCodiWebhook(
    (req.body || {}) as Record<string, unknown>,
    signature,
  );
  if (!result.accepted) {
    return res.status(400).json(result);
  }
  res.json(result);
}));

export default router;
