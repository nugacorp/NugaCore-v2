# Fase 4.9.2.5 — HTTP Hardening — Resultado

> Sub-entrega de la Fase 4.9.2.5 (Production Readiness Manual Safe Mode):
> hardening del borde HTTP. Estructura según `docs/PRODUCTION_READINESS_CHECKLIST.md`
> sección 17. Cubre el checklist §3 (security headers, CORS, rate limit).
>
> La Fase 4.9.2.5 como conjunto **NO** queda cerrada con esto: faltan backups +
> restore probado, healthchecks/alertas y runbooks (ver "Pendiente").

## Objetivo

Cerrar los huecos de seguridad del borde HTTP detectados en la auditoría:
sin security headers, sin CORS allowlist y sin rate limiting; y endurecer el
arranque para que producción no inicie con configuración insegura.

## Estado

**✅ Sub-entrega HTTP hardening COMPLETADA y verificada en local.**
Fase 4.9.2.5 global: 🟡 en progreso.

| Ítem (checklist §3) | Antes | Ahora |
|---|---|---|
| Helmet / security headers | ❌ | ✅ helmet (HSTS en prod, x-powered-by oculto) |
| HTTPS / HSTS | ❌ | ✅ HSTS activo en producción |
| CORS allowlist | ❌ | ✅ `CORS_ALLOWED_ORIGINS` por entorno |
| Rate limit | ❌ | ✅ general `/api` + estricto `/api/auth` |
| Fail-fast de config insegura en prod | ❌ (solo warn) | ✅ `validateEnvironment()` lanza |
| `AUTH_TRUST_HEADERS=false` en prod | ✅ (ya estaba) | ✅ + fail-fast si true |
| Roles desde DB (no headers) | ✅ (ya estaba) | ✅ |
| Logs sin secretos | ✅ (ya estaba) | ✅ (rate-limit loguea solo método+path) |

## Cambios

- **Nuevo** `backend/common/http-security.ts` — `applyHttpSecurity(app)`: helmet +
  CORS allowlist + rate-limit, configurables por entorno, seguros por defecto.
- `backend/app.ts` — aplica `applyHttpSecurity` antes de body-parser y rutas.
- `backend/config/env.ts` — `validateEnvironment()` ahora hace FAIL-FAST en
  producción ante `AUTH_TRUST_HEADERS=true`, `MIKROTIK_CREDENTIALS_KEY` ausente, o
  Supabase no configurado.
- `tests/setup/test-env.ts` — rate-limit OFF por defecto en todos los modos de test.
- **Nuevo** `tests/contract/http-security.contract.test.ts` — 6 tests.
- `.env.example` / `.env.production.example` — documentan las variables nuevas.
- `package.json` — deps: `helmet`, `cors`, `express-rate-limit`, `@types/cors`.

## Variables de entorno

| Variable | Default | Producción |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | vacío (niega cross-origin) | dominios reales del frontend |
| `RATE_LIMIT_ENABLED` | `true` (off en test) | `true` |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | según política |
| `RATE_LIMIT_MAX` | `300` / ventana en `/api` | según política |
| `AUTH_RATE_LIMIT_MAX` | `20` / ventana en `/api/auth` | según política |

## Flags / contratos

- Sin cambios en contratos de API (headers y CORS son aditivos; 429 sigue el
  formato de error `{ error, code }`).
- No se activó `MIKROTIK_WORKER_LIVE`, `USE_DB_WIREGUARD`, `USE_DB_MIKROTIK` ni
  commit mode. No se tocaron routers.

## Tests ejecutados (local)

- `npx tsc --noEmit` (fuente, excluyendo `dist`) → **PASS**.
- `npx vitest run` (suite no-DB, 54 archivos) → **PASS, 1006/1006**.
- Nuevos casos (`tests/contract/http-security.contract.test.ts`):
  - helmet aplica headers y oculta `x-powered-by`.
  - CORS: origen en allowlist recibe `access-control-allow-origin`.
  - CORS: origen fuera de la allowlist no la recibe.
  - CORS: petición sin Origin funciona.
  - rate-limit: supera el límite → 429 `code=RATE_LIMITED`.
  - rate-limit: desactivado no limita.

> `npm run build` debe ejecutarse en máquina/CI con `dist` limpio (en el entorno
> de desarrollo actual el borrado de `dist` está bloqueado por el filesystem).

## Seguridad / log hygiene

- helmet/cors no loguean; el handler de rate-limit registra solo método+path.
- `validateEnvironment()` registra nombres de variables, nunca sus valores.
- Sin secretos, tokens ni claves nuevos en logs.

## Pendiente para cerrar Fase 4.9.2.5

- [ ] Backups automáticos de DB + restore probado en ambiente separado (checklist §15).
- [ ] Healthchecks/alertas básicas y observabilidad mínima (checklist §14).
- [ ] Runbooks de operación (checklist §17/§18).
- [ ] Validación funcional en staging por Hermes.

## Resultado final

- [x] **Sub-entrega HTTP hardening: COMPLETADA** (local). Pendiente revalidación Hermes en staging.
- [ ] **Fase 4.9.2.5 (global): APROBADA** — tras completar lo pendiente.

## Próximo paso recomendado

Continuar 4.9.2.5 con healthchecks/alertas y backups+restore; luego revalidación
Hermes en staging. **No** iniciar 4.9.3 (provisioning real) hasta cerrar 4.9.2.5.

---

## Adenda — Observabilidad (§14)

Segunda sub-entrega de 4.9.2.5: base de observabilidad.

| Ítem (checklist §14) | Antes | Ahora |
|---|---|---|
| Logs JSON estructurados | ✅ (logger ya lo hacía en prod) | ✅ |
| Request ID / correlation ID | ❌ | ✅ `X-Request-Id` entrante (saneado) o generado; `req.log` con el id |
| Healthchecks internos/externos | ✅ /health, /live, /ready | ✅ + métricas en /health |
| Métricas de API (base) | ❌ | ✅ `requestsTotal`, `errors5xx` en `/api/health` |
| Logs sin secretos | ✅ | ✅ (id saneado con allowlist; sin valores sensibles) |

Cambios:

- **Nuevo** `backend/common/request-context.ts` — `attachRequestId`: correlation
  ID por petición, `req.log = logger.child({ requestId })`, cabecera de respuesta
  `X-Request-Id`, y conteo de peticiones/5xx en el evento `finish`.
- **Nuevo** `backend/common/metrics.ts` — contadores en memoria (`requestsTotal`,
  `errors5xx`) con `snapshot()`/`reset()`.
- `backend/types/express.d.ts` — `req.requestId` y `req.log` tipados.
- `backend/app.ts` — `attachRequestId` tras el hardening; el log de petición usa `req.log`.
- `backend/common/errors.ts` — logs 5xx incluyen `requestId` (usa `req.log`).
- `backend/domains/health/routes.ts` — `/api/health` expone `metrics`.
- **Nuevo** `tests/contract/observability.contract.test.ts` — 6 tests
  (correlation ID generado/propagado/saneado, métricas en health, contadores).

Verificación local: `npx tsc --noEmit` → PASS; `npx vitest run` (no-DB) → **1012/1012**.

Pendiente aún en 4.9.2.5: alertas por 5xx/jobs (requiere canal Telegram/email +
config), readiness con chequeo real de Supabase, backups+restore probado, runbooks,
y revalidación Hermes.
