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
//   POST /api/payments/webhook/openpay          (legacy single-WISP)
//   POST /api/payments/webhook/openpay/:token   (por WISP, T3)
// ====================================================================

import type { Request, Response } from 'express';
import { Router } from 'express';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { BadRequestError, NotFoundError, asyncHandler } from '../../common/errors';
import { logger } from '../../common/logger';
import { getIntegrationsService } from '../integrations/service';
import { DEFAULT_TENANT_ID } from '../tenancy/types';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import {
  isUsableOpenPayConfig,
  openPayConfigFromEnv,
  resolveOpenPayConfig,
  type OpenPayResolvedConfig,
} from './providers/openpay-config';
import { buildOpenPayProvider, getProvider } from './providers/index';
import { EVENT_CLAIM_LEASE_MS } from './repository';
import { getPaymentService } from './service';
import { PaymentProvider, type WebhookProcessResult } from './types';

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
        idempotencyKey: typeof req.body?.idempotencyKey === 'string'
          ? req.body.idempotencyKey
          : undefined,
      },
    );
    res.json(result);
  }),
);

// ── Webhooks ──────────────────────────────────────────────────────────

const rawBodyOf = (req: Request): Buffer | null => {
  const jsonMediaType = Boolean(req.is('application/json') || req.is('application/*+json'));
  const rawBody = (req as unknown as { rawBody?: unknown }).rawBody;
  return jsonMediaType && Buffer.isBuffer(rawBody) && rawBody.length > 0 ? rawBody : null;
};

const signatureOf = (req: Request): string =>
  (req.headers['x-signature'] as string) ||
  (req.headers['x-mp-signature'] as string) ||
  (req.headers['x-openpay-signature'] as string) || '';

/** Identidad del evento tal como la publica el proveedor. */
const webhookEventOf = (req: Request, provider: PaymentProvider) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const eventType =
    (body.type as string) || (body.action as string) || (body.event_type as string) || 'payment.update';
  const explicitEventId = (body.id as string) || (body.event_id as string);
  const transactionId = (body.transaction as { id?: string } | undefined)?.id;
  return {
    payload: body,
    eventType,
    providerEventId: String(
      explicitEventId ||
        (transactionId ? `${eventType}:${transactionId}` : `${eventType}:${provider}-${Date.now()}`),
    ),
  };
};

const openPayConfigFromPersisted = (settings: Awaited<ReturnType<
  ReturnType<typeof getIntegrationsService>['getPersistedSettingsRaw']
>>): OpenPayResolvedConfig | null => {
  if (!settings) return null;
  return {
    merchantId: settings.openpayMerchantId.trim(),
    privateKey: settings.openpayPrivateKey.trim(),
    sandbox: settings.openpaySandbox,
    webhookSecret: settings.openpayWebhookSecret || undefined,
  };
};

const sendWebhookResult = (res: Response, result: WebhookProcessResult): void => {
  if (result.idempotentReason === 'in_progress') {
    // OpenPay reintenta cuando no recibe 200. Un claim vivo no es éxito:
    // responder 503 evita que una entrega concurrente se pierda para siempre.
    res
      .set('Retry-After', String(Math.ceil(EVENT_CLAIM_LEASE_MS / 1_000)))
      .status(503)
      .json(result);
    return;
  }
  res.json(result);
};

const handleWebhook = (provider: PaymentProvider) =>
  asyncHandler(async (req, res) => {
    const rawBody = rawBodyOf(req);
    if (!rawBody) {
      res.status(415).json({
        error: 'El webhook requiere un cuerpo JSON verificable.',
        code: 'INVALID_WEBHOOK_BODY',
      });
      return;
    }
    const signature = signatureOf(req);
    let secret = process.env[`WEBHOOK_SECRET_${provider.toUpperCase()}`] || '';
    let providerImpl = getProvider(provider);

    if (provider === 'openpay') {
      const persisted = await getIntegrationsService().getPersistedSettingsRaw(DEFAULT_TENANT_ID);
      // La fila default es autoritativa: disabled corta incluso si env conserva
      // un secreto anterior. Env solo representa una instalación sin fila.
      if (persisted && !persisted.openpayEnabled) {
        logger.warn('PaymentEngine: webhook OpenPay legacy deshabilitado en la fila default');
        res.status(503).json({ error: 'Webhook no configurado.', code: 'WEBHOOK_NOT_CONFIGURED' });
        return;
      }
      const config = openPayConfigFromPersisted(persisted) ?? openPayConfigFromEnv();
      secret = config.webhookSecret || '';
      providerImpl = buildOpenPayProvider(config);
    }

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

    const verify = providerImpl.verifyWebhook(rawBody, signature, secret);

    if (!verify.valid) {
      logger.warn('PaymentEngine: firma de webhook inválida', { provider, reason: verify.reason });
      res.status(400).json({ error: 'Firma de webhook inválida.', code: 'INVALID_SIGNATURE' });
      return;
    }

    const result = await getPaymentService().processWebhook({
      provider,
      ...webhookEventOf(req, provider),
      // Ruta legacy sin token: pertenece SIEMPRE al WISP por defecto. Nunca
      // puede alcanzar a otro tenant (no abre multi-tenant).
      tenantId: DEFAULT_TENANT_ID,
    });

    sendWebhookResult(res, result);
  });

router.post('/api/payments/webhook/manual', handleWebhook('manual'));
router.post('/api/payments/webhook/mercadopago', handleWebhook('mercado_pago'));
router.post('/api/payments/webhook/openpay', handleWebhook('openpay'));

// ── Webhook OpenPay por WISP (T3) ─────────────────────────────────────
//
// El token opaco de la URL resuelve el tenant; la firma se verifica con el
// webhook secret DE ESE WISP. Todo rechazo devuelve la misma respuesta: la
// ruta no revela si el token existe, si el WISP tiene OpenPay habilitado ni
// si su firma fue la que falló. El motivo real queda solo en el log del
// servidor, nunca con el token ni el secreto.

const WEBHOOK_REJECTED = { error: 'Webhook no disponible.', code: 'WEBHOOK_REJECTED' } as const;

const rejectWebhook = (res: Response, reason: string, meta: Record<string, unknown> = {}): void => {
  logger.warn('PaymentEngine: webhook OpenPay rechazado', { reason, ...meta });
  res.status(404).json(WEBHOOK_REJECTED);
};

router.post(
  '/api/payments/webhook/openpay/:token',
  asyncHandler(async (req, res) => {
    const rawBody = rawBodyOf(req);
    if (!rawBody) {
      // La ruta tokenizada no revela si el token o el tenant existen.
      rejectWebhook(res, 'invalid_webhook_body');
      return;
    }
    const token = String(req.params.token ?? '').trim();
    const owner = token
      ? await getIntegrationsService().resolveOpenPayWebhookTenant(token)
      : null;
    if (!owner) {
      rejectWebhook(res, 'unknown_token');
      return;
    }

    const { tenantId, settings } = owner;
    if (!settings.openpayEnabled) {
      rejectWebhook(res, 'openpay_disabled', { tenantId });
      return;
    }

    // Credenciales del WISP. `env` solo cubre al tenant por defecto: un WISP
    // sin credenciales propias NO hereda las de otro ni las globales.
    const config = await resolveOpenPayConfig(tenantId);
    if (!isUsableOpenPayConfig(config)) {
      // Config vacía ⇒ el provider entraría en modo simulado, y el simulado
      // acepta cualquier firma. En esta ruta pública eso jamás puede pasar.
      rejectWebhook(res, 'no_usable_credentials', { tenantId });
      return;
    }

    const secret = (config.webhookSecret ?? '').trim();
    if (!secret) {
      rejectWebhook(res, 'missing_webhook_secret', { tenantId });
      return;
    }

    const signature = signatureOf(req);
    if (!signature) {
      rejectWebhook(res, 'missing_signature', { tenantId });
      return;
    }

    const verify = buildOpenPayProvider(config).verifyWebhook(rawBody, signature, secret);
    if (!verify.valid) {
      rejectWebhook(res, verify.reason ?? 'invalid_signature', { tenantId });
      return;
    }

    const result = await getPaymentService().processWebhook({
      provider: 'openpay',
      ...webhookEventOf(req, 'openpay'),
      tenantId,
    });

    sendWebhookResult(res, result);
  }),
);

export default router;
