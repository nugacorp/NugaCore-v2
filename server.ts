import fs from 'fs';
import path from 'path';
import { createApp } from './backend/app';
import { env, isProduction, validateEnvironment } from './backend/config/env';
import { logger } from './backend/common/logger';
import { startNocPoller } from './backend/domains/noc-poller/service';
import { startSnmpPoller } from './backend/domains/snmp-poller/service';
import { hydrateMikrotikRoutersFromDb } from './backend/domains/mikrotik/repository';
import { startWireguardHostApplyReconcile } from './backend/domains/wireguard/host-apply';
import { getWireguardService } from './backend/domains/wireguard/service';

// ── Modo de servido (Fase 4.5.2) ─────────────────────────────────────
// El Vite dev server bloquea hosts desconocidos ("This host is not allowed")
// y escribe en node_modules/.vite (falla como usuario no-root). Eso es SOLO
// para desarrollo. En staging/producción debe servirse el build estático.
//
// Regla robusta (no depende de que NODE_ENV sea exactamente 'production'):
//   - SERVE_MODE=static|dev fuerza el modo.
//   - production → static.
//   - si existe dist/index.html (imagen ya construida, p.ej. staging) → static.
//   - solo sin build y en desarrollo → Vite dev server.
function resolveServeMode(): 'static' | 'dev' {
  const explicit = (process.env.SERVE_MODE || '').trim().toLowerCase();
  if (explicit === 'static' || explicit === 'dev') return explicit;
  if (isProduction) return 'static';
  const hasBuild = fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'));
  return hasBuild ? 'static' : 'dev';
}

async function startServer() {
  validateEnvironment();

  const app = createApp();
  const serveMode = resolveServeMode();

  if (serveMode === 'dev') {
    // Import perezoso de Vite: así NO queda como dependencia eager en el
    // bundle de producción y la imagen de runtime puede usar `--omit=dev`.
    const { createServer: createViteServer } = await import('vite');
    // allowedHosts EXPLÍCITO desde env (lista separada por comas). Nunca
    // wildcard por defecto: solo se permiten los hosts declarados.
    const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(allowedHosts.length ? { allowedHosts } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    logger.info('NugaCore: modo desarrollo (Vite middleware)', {
      allowedHosts: allowedHosts.length ? allowedHosts.join(',') : 'default',
    });
  } else {
    logger.info('NugaCore: sirviendo build estático de producción (dist/)', { mode: env.NODE_ENV });
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

    // SPA fallback solo para rutas de navegación (sin extensión de archivo).
    // Si un chunk .js/.css viejo ya no existe tras un deploy, devolver 404
    // (NO index.html): si no, el navegador recibe text/html y falla con
    // "Expected a JavaScript module script but the server responded with
    // MIME type text/html".
    app.get('*', (req, res) => {
      const pathname = (req.path || '').split('?')[0] || '';
      const looksLikeStaticFile =
        /\.[a-zA-Z0-9]+$/.test(pathname) && !pathname.toLowerCase().endsWith('.html');
      if (looksLikeStaticFile) {
        res
          .status(404)
          .setHeader('Cache-Control', 'no-store')
          .type('text/plain')
          .send('Not found');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  try {
    await hydrateMikrotikRoutersFromDb();
  } catch (err) {
    logger.warn('No se pudieron hidratar routers MikroTik desde Supabase', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`NugaCore server running on http://0.0.0.0:${env.PORT}`, { mode: env.NODE_ENV });
    startNocPoller();
    startSnmpPoller();
    // Asegura loader + reconcile periódico peers → host wg0 (si apply está habilitado).
    try {
      getWireguardService();
    } catch (err) {
      logger.warn('WireGuard service no disponible al arrancar host-apply', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    startWireguardHostApplyReconcile();
  });
}

startServer();
