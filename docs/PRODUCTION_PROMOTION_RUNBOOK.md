# NugaCore — Runbook de Promoción a Producción

Flujo: **CI verde → staging validado → producción**.

## Pre-requisitos

- [ ] `main` con CI y production-gates en verde.
- [ ] Staging con OLA 0 cerrada (`ola0PersistenceClosed=true`).
- [ ] `PRODUCTION_RESTORE_TESTED=true` tras restore documentado.
- [ ] Supabase **producción** separado de staging.
- [ ] Coolify producción separado o aislado.

## Paso 1 — Preparar entorno producción (Coolify)

1. Crear aplicación desde repo `nugacorp/nugacore-v2`, rama `main`.
2. Cargar variables desde `.env.production.example` (como secrets).
3. Obligatorios:
   - `NODE_ENV=production`
   - `PUBLIC_DEPLOYMENT=true`
   - `AUTH_TRUST_HEADERS=false`
   - `SUPABASE_*` del proyecto **producción**
   - `MIKROTIK_CREDENTIALS_KEY`
   - `WEBHOOK_SECRET_MANUAL` (si `USE_DB_PAYMENTS=true`)
   - `CORS_ALLOWED_ORIGINS` con dominio real
   - Flags `USE_DB_*` críticos en `true`
4. Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENABLE_QUICK_LOGIN=false`.

## Paso 2 — Migraciones

1. Backup manual (ver `BACKUP_RESTORE_RUNBOOK.md`).
2. Aplicar migraciones en orden desde `supabase/migrations/`.
3. `NOTIFY pgrst, 'reload schema';`
4. `RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs`

## Paso 3 — Deploy

1. `bash scripts/vps/preflight.sh`
2. Deploy en Coolify (tag/commit acordado).
3. `APP_URL=https://prod... bash scripts/vps/validate-production.sh`
4. `AUTH_BEARER=<jwt> bash scripts/smoke-production.sh https://prod...`

## Paso 4 — Gate final

```bash
AUTH_BEARER=<jwt> APP_URL=https://prod... node scripts/validate-production-readiness.mjs
```

Esperado: `readyForProduction: true` (sin blockers).

## Paso 5 — Rollback ensayado

1. Coolify → Deployments → rollback a versión anterior.
2. Repetir validate-production.
3. Documentar en `docs/PRODUCTION_PROMOTION_RESULT.md` (commit, flags, PASS/FAIL).

## Lo que NO activar sin autorización

- `MIKROTIK_WORKER_LIVE=true`
- `USE_DB_MIKROTIK=true`
- RouterOS write en routers reales
- Suspensión automática en routers de clientes
