import express from 'express';
import { attachAuthContext } from './common/auth-context';
import { errorHandler } from './common/errors';
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

  app.use(errorHandler);

  return app;
}
