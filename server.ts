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
    const expressMod = (await import('express')).default;
    const ONE_YEAR = 31536000; // segundos

    // ── Cache busting (Fase 4.3.1) ───────────────────────────────────
    // Vite genera assets con hash de contenido (dist/assets/index-<hash>.js).
    //   - Assets hasheados → cache inmutable de 1 año (el hash invalida).
    //   - index.html → SIN cache: cada deploy debe entregar los hashes nuevos
    //     y evitar que un proxy/navegador sirva un bundle viejo (pantalla en
    //     blanco tras deploy).
    app.use(
      expressMod.static(distPath, {
        etag: true,
        lastModified: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
          }
        },
      }),
    );

    // SPA fallback: el HTML del shell nunca se cachea de forma agresiva.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`NugaCore server running on http://0.0.0.0:${env.PORT}`, { mode: env.NODE_ENV });
  });
}

startServer();
