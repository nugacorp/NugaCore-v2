import express from 'express';
import { attachAuthContext } from './common/auth-context';
import { errorHandler, notFoundHandler } from './common/errors';
import { applyHttpSecurity } from './common/http-security';
import { logger } from './common/logger';
import { attachRequestId } from './common/request-context';
import { attachSecurityAudit } from './common/security-audit';
import { registerRoutes } from './register-routes';

export function createApp() {
  const app = express();

  // Hardening HTTP (Fase 4.9.2.5): helmet + CORS allowlist + rate-limit.
  // Va primero, antes de parsear el body y registrar rutas.
  applyHttpSecurity(app);

  // Correlation ID por petición (req.requestId / req.log / X-Request-Id).
  app.use(attachRequestId);

  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));
  app.use((req, _res, next) => {
    (req.log ?? logger).info(`${req.method} ${req.path}`);
    next();
  });
  app.use(attachAuthContext);
  app.use(attachSecurityAudit);

  registerRoutes(app);

  // 404 JSON solo para rutas /api no encontradas. Las rutas no-/api siguen
  // cayendo al servidor de Vite (dev) o al fallback SPA (prod) en server.ts.
  app.use('/api', notFoundHandler);

  app.use(errorHandler);

  return app;
}
