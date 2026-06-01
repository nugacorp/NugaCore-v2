import path from 'path';
import { createApp } from './backend/app';
import { env, isProduction, validateEnvironment } from './backend/config/env';
import { logger } from './backend/common/logger';

async function startServer() {
  validateEnvironment();

  const app = createApp();

  if (!isProduction) {
    // Import perezoso de Vite: así NO queda como dependencia eager en el
    // bundle de producción y la imagen de runtime puede usar `--omit=dev`.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use((await import('express')).default.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`NugaCore server running on http://0.0.0.0:${env.PORT}`, { mode: env.NODE_ENV });
  });
}

startServer();
