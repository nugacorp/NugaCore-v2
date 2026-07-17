// ====================================================================
// Rutas del dominio Payment Engine (Fase 4.8).
//
// Endpoints protegidos (RBAC):
//   GET  /api/payments/orders
//   GET  /api/payments/orders/:id
//   POST /api/payments/orders
//   GET  /api/payments/actions
//   POST /api/payments/customers/:customerId/reactivate
//
// Webhooks (sin auth — validar firma del proveedor):
//   POST /api/payments/webhook/manual
//   POST /api/payments/webhook/mercadopago
//   POST /api/payments/webhook/openpay
// ====================================================================

import { Router } from 'express';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { BadRequestError, NotFoundError, asyncHandler } from '../../common/errors';
import { logger } from '../../common/logger';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getProvider } from './providers/index';
import { getPaymentService } from './service';
import { PaymentProvider } from './types';

const router = Router();

const WRITE_ROLES: AppRole[] = ['super admin', 'administrador', 'cobranza'];

// ── Payment Orders ────────────────────────────────────────────────────

router.get(
  '/api/payments/orders',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const { customerId, invoiceId } = req.query as Record<string, string | undefined>;
    const orders = await getPaymentService().listOrders({
      customerId,
      invoiceId,
      tenantId: tenantIdFromRequest(req),
    });
    res.json(orders);
  }),
);

router.get(
  '/api/payments/orders/:id',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const order = await getPaymentService().getOrder(req.params.id, tenantIdFromRequest(req));
    if (!order) throw new NotFoundError('Payment order no encontrada.', 'NOT_FOUND');
    res.json(order);
  }),
);

router.post(
  '/api/payments/orders',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { customerId, invoiceId, provider, amountCents, amount } = req.body || {};

    if (!customerId || !invoiceId || !provider) {
      throw new BadRequestError('customerId, invoiceId y provider son obligatorios.');
    }

    // Dual-format: amount (pesos, alias UI) o amountCents (centavos, canónico).
    // Si vienen ambos y no coinciden → 400 para evitar ambigüedad.
    let resolvedCents: number;
    if (amountCents !== undefined && amount !== undefined) {
      const fromCents = Math.round(Number(amountCents));
      const fromPesos = Math.round(Number(amount) * 100);
      if (!Number.isFinite(fromCents) || !Number.isFinite(fromPesos) || fromCents !== fromPesos) {
        throw new BadRequestError(
          'amount y amountCents no coinciden. Envíe solo uno de los dos.',
          'AMOUNT_MISMATCH',
        );
      }
      resolvedCents = fromCents;
    } else if (amountCents !== undefined) {
      resolvedCents = Math.round(Number(amountCents));
    } else if (amount !== undefined) {
      resolvedCents = Math.round(Number(amount) * 100);
    } else {
      throw new BadRequestError('Se requiere amount (pesos) o amountCents (centavos).');
    }
    if (!Number.isFinite(resolvedCents) || resolvedCents <= 0) {
      throw new BadRequestError('El monto debe ser un valor positivo.');
    }

    const order = await getPaymentService().createOrder({
      customerId: String(customerId),
      invoiceId: String(invoiceId),
      provider: String(provider) as PaymentProvider,
      amountCents: resolvedCents,
      tenantId: tenantIdFromRequest(req),
    });
    res.status(201).json(order);
  }),
);

// ── Mikrotik Actions ──────────────────────────────────────────────────

router.get(
  '/api/payments/actions',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const { customerId } = req.query as Record<string, string | undefined>;
    const actions = await getPaymentService().listActions({
      customerId,
      tenantId: tenantIdFromRequest(req),
    });
    res.json(actions);
  }),
);

// ── Reactivación lógica (manual desde el panel) ───────────────────────

router.post(
  '/api/payments/customers/:customerId/reactivate',
  requireRoles(WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const result = await getPaymentService().reactivateCustomerService(
      req.params.customerId,
      {
        triggeredBy: req.authContext?.userId ?? 'operator',
        tenantId: tenantIdFromRequest(req),
      },
    );
    res.json(result);
  }),
);

// ── Webhooks ──────────────────────────────────────────────────────────

const handleWebhook = (provider: PaymentProvider) =>
  asyncHandler(async (req, res) => {
    const rawBody: string | Buffer =
      (req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body ?? {});
    const signature = (req.headers['x-signature'] as string) ||
      (req.headers['x-mp-signature'] as string) ||
      (req.headers['x-openpay-signature'] as string) || '';
    const secret = process.env[`WEBHOOK_SECRET_${provider.toUpperCase()}`] || '';

    // Fail-closed (C-01): en un despliegue publico (produccion o
    // PUBLIC_DEPLOYMENT) un webhook SIN secreto configurado se rechaza, para que
    // un endpoint accesible desde internet no apruebe pagos sin verificacion.
    const isHardened =
      process.env.NODE_ENV === 'production' ||
      (process.env.PUBLIC_DEPLOYMENT || '').toLowerCase() === 'true';
    if (!secret && isHardened) {
      logger.warn('PaymentEngine: webhook sin secreto en runtime endurecido; rechazado', { provider });
      res.status(503).json({ error: 'Webhook no configurado.', code: 'WEBHOOK_NOT_CONFIGURED' });
      return;
    }

    const providerImpl = getProvider(provider);
    const verify = providerImpl.verifyWebhook(rawBody, signature, secret);

    if (!verify.valid) {
      logger.warn('PaymentEngine: firma de webhook inválida', { provider, reason: verify.reason });
      res.status(400).json({ error: 'Firma de webhook inválida.', code: 'INVALID_SIGNATURE' });
      return;
    }

    const body = req.body || {};
    const eventType = (body.type as string) || (body.action as string) || (body.event_type as string) || 'payment.update';
    const providerEventId =
      (body.id as string) ||
      (body.event_id as string) ||
      (body.transaction?.id as string) ||
      `${provider}-${Date.now()}`;

    const result = await getPaymentService().processWebhook({
      provider,
      providerEventId: String(providerEventId),
      eventType,
      payload: body as Record<string, unknown>,
    });

    res.json(result);
  });

router.post('/api/payments/webhook/manual', handleWebhook('manual'));
router.post('/api/payments/webhook/mercadopago', handleWebhook('mercado_pago'));
router.post('/api/payments/webhook/openpay', handleWebhook('openpay'));

export default router;
