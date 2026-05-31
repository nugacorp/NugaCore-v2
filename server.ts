import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './backend/app';
import { env, isProduction } from './backend/config/env';

async function startServer() {
  const app = createApp();

  if (!isProduction) {
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
    console.log(`[NugaCore Server] running on http://0.0.0.0:${env.PORT} in ${env.NODE_ENV} mode`);
  });
}

startServer();
