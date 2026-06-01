import express from 'express';
import { attachAuthContext } from './common/auth-context';
import { errorHandler, notFoundHandler } from './common/errors';
import { logger } from './common/logger';
import { attachSecurityAudit } from './common/security-audit';
import { registerRoutes } from './register-routes';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.path}`);
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
