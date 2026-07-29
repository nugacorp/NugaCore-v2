// ====================================================================
// Hardening HTTP (Fase 4.9.2.5 — Production Readiness Manual Safe Mode).
//
// Añade tres capas de borde, todas configurables por entorno y seguras por
// defecto, sin romper contratos de API ni el SPA same-origin:
//
//   1. helmet      → security headers (HSTS solo en producción/HTTPS).
//   2. cors        → allowlist por entorno (CORS_ALLOWED_ORIGINS).
//   3. rate-limit  → límite general en /api y límite estricto en /api/auth.
//
// La configuración se lee de process.env en tiempo de createApp() (no del
// objeto `env` congelado) para que los tests puedan ajustarla por caso.
//
// Variables de entorno:
//   CORS_ALLOWED_ORIGINS   Lista separada por comas. Vacío = niega cross-origin.
//   RATE_LIMIT_ENABLED     'true'/'false'. Default: true (prod/dev), false (test).
//   RATE_LIMIT_WINDOW_MS   Ventana en ms. Default 900000 (15 min).
//   RATE_LIMIT_MAX         Máx. peticiones/ventana en /api. Default 300.
//   AUTH_RATE_LIMIT_MAX    Máx. peticiones/ventana en /api/auth. Default 20.
// ====================================================================

import type { Express, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { logger } from './logger';
import { redactSensitivePath } from './log-redaction';

const isTrue = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : value.toLowerCase() === 'true';

const parseList = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const parsePositive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Aplica las capas de seguridad HTTP a la app Express. Idempotente por app:
 * llamar una sola vez al construir la app, ANTES de registrar las rutas.
 */
export function applyHttpSecurity(app: Express): void {
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  // Runtime endurecido: produccion real O despliegue publico (PUBLIC_DEPLOYMENT).
  // Se lee de process.env para que un staging expuesto active HSTS/CSP/trust
  // proxy aunque NODE_ENV no sea 'production'.
  const isHardened = isProd || (process.env.PUBLIC_DEPLOYMENT || '').toLowerCase() === 'true';

  // Detras de proxy (Coolify) confiamos en 1 hop para que rate-limit/IP
  // funcionen con X-Forwarded-For sin abrir spoofing.
  if (isHardened) app.set('trust proxy', 1);

  // ── 1. Helmet ─────────────────────────────────────────────────────
  // CSP (Fase 6 production-ready): activa salvo que se desactive por env.
  //   - script-src 'self': el build de Vite no usa scripts inline.
  //   - style-src incluye 'unsafe-inline': los componentes usan style={{}}
  //     (style-src-attr) y Tailwind inyecta <style> en dev.
  //   - connect-src: 'self' + CSP_CONNECT_SRC (p.ej. la URL de Supabase a la
  //     que el cliente se conecta directamente; lista separada por comas).
  //   - En dev/test se desactiva: el dev server de Vite necesita inline/eval.
  // HSTS solo en producción (no tiene efecto fuera de HTTPS y evita líos en dev).
  const cspEnabled = isHardened && isTrue(process.env.CSP_ENABLED, true);
  // Preferir CSP_CONNECT_SRC explícito; si falta, permitir Supabase del runtime
  // (evita bloquear auth/refresh del cliente con PUBLIC_DEPLOYMENT=true).
  const extraConnect = (() => {
    const listed = parseList(process.env.CSP_CONNECT_SRC);
    if (listed.length > 0) return listed;
    const fromEnv = [
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_URL,
    ]
      .map((u) => (u || '').trim().replace(/\/$/, ''))
      .filter(Boolean);
    return [...new Set(fromEnv)];
  })();
  app.use(
    helmet({
      contentSecurityPolicy: cspEnabled
        ? {
            useDefaults: false,
            directives: {
              'default-src': ["'self'"],
              'script-src': ["'self'"],
              'style-src': ["'self'", "'unsafe-inline'"],
              // Tiles GIS (Leaflet/CARTO/OSM) — Co-Map fluido estilo UISP.
              'img-src': [
                "'self'",
                'data:',
                'blob:',
                'https://*.basemaps.cartocdn.com',
                'https://basemaps.cartocdn.com',
                'https://*.tile.openstreetmap.org',
                'https://tile.openstreetmap.org',
              ],
              'font-src': ["'self'", 'data:'],
              'connect-src': ["'self'", ...extraConnect],
              // Leaflet canvas / workers ocasionales
              'worker-src': ["'self'", 'blob:'],
              'object-src': ["'none'"],
              'base-uri': ["'self'"],
              'frame-ancestors': ["'self'"],
              'form-action': ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      hsts: isHardened,
    }),
  );

  // ── 2. CORS allowlist ─────────────────────────────────────────────
  // Peticiones sin Origin (curl, same-origin, healthchecks, supertest) pasan.
  // Con Origin: solo si está en la allowlist. Sin allowlist => niega cross-origin.
  const allowedOrigins = parseList(process.env.CORS_ALLOWED_ORIGINS);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, false);
        return callback(null, allowedOrigins.includes(origin));
      },
      credentials: true,
    }),
  );

  // ── 3. Rate limiting ──────────────────────────────────────────────
  // Desactivado por defecto en test (los contratos hacen muchas peticiones);
  // activable con RATE_LIMIT_ENABLED=true para los tests dedicados.
  const rateLimitEnabled = isTrue(process.env.RATE_LIMIT_ENABLED, !isTest);
  if (!rateLimitEnabled) return;

  const windowMs = parsePositive(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  const apiMax = parsePositive(process.env.RATE_LIMIT_MAX, 300);
  const authMax = parsePositive(process.env.AUTH_RATE_LIMIT_MAX, 20);

  const limitHandler = (message: string) => (req: Request, res: Response) => {
    logger.warn(`Rate limit alcanzado: ${req.method} ${redactSensitivePath(req.originalUrl || req.path)}`);
    res.status(429).json({ error: message, code: 'RATE_LIMITED' });
  };

  const authLimiter = rateLimit({
    windowMs,
    limit: authMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: limitHandler('Demasiados intentos. Espera unos minutos e intenta de nuevo.'),
  });

  const apiLimiter = rateLimit({
    windowMs,
    limit: apiMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: limitHandler('Demasiadas solicitudes. Intenta de nuevo más tarde.'),
  });

  // El límite estricto de auth se registra primero para que /api/auth lo use.
  app.use('/api/auth', authLimiter);
  // Registro público de WISP: mismo techo estricto que auth (anti-abuso).
  app.use('/api/wisp-onboarding/register', authLimiter);
  app.use('/api', apiLimiter);
}
