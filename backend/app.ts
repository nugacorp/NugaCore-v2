import express from 'express';
import type { IncomingMessage } from 'http';
import { attachAuthContext } from './common/auth-context';
import { errorHandler, notFoundHandler } from './common/errors';
import { applyHttpSecurity } from './common/http-security';
import { redactSensitivePath } from './common/log-redaction';
import { logger } from './common/logger';
import { enforceWispOnboarding } from './common/require-onboarding';
import { attachRequestId } from './common/request-context';
import { attachSecurityAudit } from './common/security-audit';
import { registerRoutes } from './register-routes';

// Los proveedores de pago firman los BYTES que envían, no una reserialización
// nuestra: `JSON.stringify(req.body)` pierde espaciado y orden, y con ello
// invalidaría firmas legítimas. Solo estas rutas conservan el cuerpo crudo; el
// resto de la API no retiene nada (el límite de tamaño sigue siendo el mismo).
const WEBHOOK_RAW_BODY_PREFIX = '/api/payments/webhook/';

const captureWebhookRawBody = (req: IncomingMessage, _res: unknown, buf: Buffer): void => {
  const path = String(req.url || '').split('?')[0];
  if (!path.startsWith(WEBHOOK_RAW_BODY_PREFIX)) return;
  (req as unknown as { rawBody?: Buffer }).rawBody = buf;
};

export function createApp() {
  const app = express();

  // Hardening HTTP (Fase 4.9.2.5): helmet + CORS allowlist + rate-limit.
  // Va primero, antes de parsear el body y registrar rutas.
  applyHttpSecurity(app);

  // Correlation ID por petición (req.requestId / req.log / X-Request-Id).
  app.use(attachRequestId);

  app.use(express.json({
    limit: process.env.JSON_BODY_LIMIT || '100kb',
    verify: captureWebhookRawBody,
  }));
  app.use((req, _res, next) => {
    (req.log ?? logger).info(`${req.method} ${redactSensitivePath(req.path)}`);
    next();
  });
  app.use(attachAuthContext);
  app.use(attachSecurityAudit);
  app.use(enforceWispOnboarding);

  registerRoutes(app);

  // 404 JSON solo para rutas /api no encontradas. Las rutas no-/api siguen
  // cayendo al servidor de Vite (dev) o al fallback SPA (prod) en server.ts.
  app.use('/api', notFoundHandler);

  app.use(errorHandler);

  return app;
}
