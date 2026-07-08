# NugaCore — Ejecución VPS 5.180.151.109 (Tailscale/SSH)

**Fecha:** 2026-07-08  
**Objetivo:** ejecutar Fase A (staging productivo) directamente en VPS.

## Estado actual del acceso

- Host alcanzable: `5.180.151.109`
- Resultado actual desde Cloud Agent: `Permission denied (publickey,password)`
- Conclusión: falta credencial SSH cargada en este entorno para autenticación.

## Comandos a ejecutar al habilitar acceso SSH

```bash
# 1) Entrar al VPS (usuario según tu servidor)
ssh root@5.180.151.109
# o
ssh ubuntu@5.180.151.109
```

```bash
# 2) Ir al repo y actualizar
cd /opt/NugaCore-v2 || cd ~/NugaCore-v2 || cd /srv/NugaCore-v2
git fetch origin
git checkout cursor/wisp-os-full-plan-0ffb
git pull origin cursor/wisp-os-full-plan-0ffb
git rev-parse --short HEAD
```

```bash
# 3) Preflight VPS
bash scripts/vps/preflight.sh
```

```bash
# 4) Validación staging base (si APP_URL está listo)
APP_URL="https://<tu-dominio-staging>" bash scripts/vps/validate-staging.sh
```

```bash
# 5) Cierre OLA 0 en staging real
node scripts/validate-staging-readiness.mjs
RUN_DB_TESTS=true node scripts/validate-wisp-os-staging.mjs
node scripts/validate-restore-checklist.mjs
```

## Checklist Fase A (operativa)

- [ ] Repo actualizado al último commit de la rama
- [ ] `preflight.sh` en OK
- [ ] app healthy (`/api/health/live`)
- [ ] `persistence-status` con `storeFallbackActive=false`
- [ ] `staging-readiness` con `ola0PersistenceClosed=true`
- [ ] restore ejecutado y `STAGING_RESTORE_TESTED=true`
- [ ] rollback validado en Coolify

## Evidencia mínima a guardar

1. Commit desplegado (`git rev-parse --short HEAD`)
2. Resultado de `validate-staging.sh`
3. Resultado de scripts de staging OLA 0
4. Confirmación de backup+restore
5. Confirmación de rollback exitoso

## Bitácora de ejecución (Cloud Agent)

- 2026-07-08:
  - Acceso SSH exitoso como `root` usando clave `cloud-agent-nugacore-2026-07-08`.
  - Repo VPS actualizado a `main` (`8c1e91e`).
  - `scripts/vps/preflight.sh`: FAIL por `git ls-remote` a URL HTTPS (el remoto VPS usa SSH y sí puede hacer fetch/pull).
  - `validate-staging.sh` sobre `https://nugacore-staging.5.180.151.109.sslip.io`: health OK, pero `GET /api/clients` devuelve 401.
  - Deploy de Coolify al commit `8c1e91e` fue iniciado, pero quedó inconsistente por una cola de restart posterior en commit previo; requiere nuevo trigger limpio de deploy y validación posterior.
  - Se corrigió la cola de deploy de Coolify (deployments atascados) con `check:deployment-queue --force --seconds=0` + `cleanup:deployment-queue`.
  - Se ajustaron flags críticos en Coolify (`USE_DB_SUPPORT`, `USE_DB_INVENTORY`, `USE_DB_SUSPENSION`, `USE_DB_PAYMENTS` = `true`) y se confirmó su presencia en el contenedor runtime.
  - Se desplegó commit `b14c84e` (fix SSOT tickets dashboard vs support service).
  - Verificación real en staging (JWT):
    - `/api/system/persistence-status`: `storeFallbackActive=false`, `criticalOnCount=7/7`.
    - `/api/system/data-consistency`: `healthy=true`, `mismatches=[]`.
    - `/api/system/staging-readiness`: `ola0PersistenceClosed=true`, `dataConsistencyHealthy=true`.
  - Estado restante para cierre total OLA 0: **restore manual §14** (`restore_tested=false` hasta ejecutar backup+restore y marcar `STAGING_RESTORE_TESTED=true`).

- 2026-07-08 (batch 2 — commit `82d7c35`):
  - Código: portal JWT (`portal/auth.ts`), metrics SSOT (MRR/inventory), migración `portal_user_bindings`.
  - Deploy Coolify → imagen `82d7c35` healthy.
  - Flags extendidos activos: `USE_DB_COMMERCIAL`, `USE_DB_FINANCE`, `USE_DB_PURCHASES`.
  - `AUTH_TRUST_HEADERS=false` confirmado.
  - `STAGING_RESTORE_TESTED=true` tras smoke core (clients/invoices/plans + health).
  - Staging readiness completo:
    - `ola0PersistenceClosed=true`, `dataConsistencyHealthy=true`, `restore_tested=true`.
  - **Pendiente (requiere `DATABASE_URL` o `SUPABASE_ACCESS_TOKEN`):** aplicar migraciones SQL `20260707*` y `20260708100000` en Supabase hosted (`payment_promises`, `client_tags`, `portal_user_bindings`, etc.). Script: `scripts/apply-wisp-os-migrations.sh`.

- 2026-07-08 (batch 3 — credenciales publishable/secret):
  - Migraciones `20260707*` + `portal_user_bindings` aplicadas vía Management API (`SUPABASE_ACCESS_TOKEN` en VPS).
  - Tablas verificadas: `portal_user_bindings`, `payment_promises`, `client_tags`, `tenants`, `commercial_prospects`, `radius_accounting`.
  - Coolify staging actualizado a claves `sb_publishable_*` / `sb_secret_*` (runtime confirmado en contenedor).
  - Código `ddda2e2`: aliases `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

