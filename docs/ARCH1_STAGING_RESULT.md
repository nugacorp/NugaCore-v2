# ARCH-1 + ARCH-1.1 — Staging Validation

Fecha: 2026-06-25
Rama validada: `main`
HEAD desplegado: `24fb0679c557d7063d0736e9105314f5215465f3`
Resultado final: ✅ APROBADAS

## Commits validados

- ARCH-1: `2cb3427` — `refactor(arch1): harden architecture and eliminate technical debt`
- ARCH-1.1: `24fb067` — `chore(repo): document build artifact policy`

Confirmados en `git log --oneline -20` de `/opt/nugacore-staging`:

```text
24fb067 chore(repo): document build artifact policy
2cb3427 refactor(arch1): harden architecture and eliminate technical debt
```

## Actualización de repo staging

Ejecutado en `/opt/nugacore-staging`:

- `git fetch origin`: OK
- `git checkout main`: OK
- `git pull --ff-only origin main`: OK
- `git log --oneline -20`: OK, ambos commits presentes

## Diff ARCH-1 (`eb4ea0a..2cb3427`)

Archivos de código tocados por ARCH-1:

- `backend/common/time.ts` nuevo.
- `backend/config/feature-flags.ts` actualizado.
- Reemplazos de `nowIso` local por import central en dominios backend.
- `backend/domains/wireguard/service.ts` delega `USE_DB_WIREGUARD` a helper central.

Conclusión del diff:

- `backend/common/time.ts` centraliza `nowIso()` como `new Date().toISOString()`.
- Los imports fueron actualizados para usar `nowIso` centralizado.
- `USE_DB_WIREGUARD` queda delegado a `useDbWireguard()` en `backend/config/feature-flags.ts`.
- No se cambiaron rutas de endpoints.
- No se cambiaron contratos/payloads.
- No se cambió RBAC.
- No se cambió UI.
- No se agregó RouterOS write.
- No se agregó Worker Live.
- Los matches de “RouterOS/Worker Live” del diff fueron documentales, no ejecución.

## Diff ARCH-1.1 (`2cb3427..24fb067`)

Archivos tocados:

- `docs/BUILD_ARTIFACT_POLICY.md` creado.
- `docs/ARCHITECTURE_AUDIT.md` actualizado.

Conclusión:

- Sin cambios de código funcional.
- Sin cambios backend lógico.
- Sin cambios frontend lógico.
- Sin cambios RouterOS.
- Sin cambios Worker Live.

## Build artifact policy

Validado:

- `git ls-files dist/` devuelve 0 archivos.
- `dist/` está ignorado por `.gitignore` (`dist/`).
- `git check-ignore dist/server.cjs` confirma que `dist/` está ignorado.
- `Dockerfile` construye desde fuente:
  - Stage build: `npm ci` + `npm run build`.
  - Runtime: copia `--from=build /app/dist ./dist`.
- `docker-compose.prod.yml` usa `build` con `dockerfile: Dockerfile`.
- Deploy no depende de `dist/` versionado.

## Checks

Ejecutados en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS
- `npm test`: PASS
  - Test Files: `137 passed | 8 skipped`
  - Tests: `1712 passed | 49 skipped`
- `npm run build`: PASS
  - `vite build`: OK
  - `esbuild server.ts`: OK

## Deploy staging

Redeploy Coolify ejecutado con HEAD actual:

- Commit desplegado: `24fb0679c557d7063d0736e9105314f5215465f3`.
- Deployment status: `finished`.
- Imagen activa: commit `24fb0679c557d7063d0736e9105314f5215465f3`.
- Contenedor: healthy.

Health endpoints:

- `/api/health`: 200
- `/api/health/live`: 200
- `/api/health/ready`: 200

## Smoke test funcional

Validación API con usuario temporal Supabase/JWT (`source=supabase-jwt`), eliminado al finalizar.

Endpoints smoke:

- Dashboard: `/api/dashboard-stats` → 200
- Clientes: `/api/clients` → 200
- Client 360 history: `/api/clients/:id/history` → 200
- Billing invoices: `/api/billing/invoices` → 200
- Billing KPIs: `/api/dashboard/billing-kpis` → 200
- Service Status summary: `/api/service-status/summary` → 200
- Service Status customer: `/api/service-status/customers/:id` → 200
- Provisioning Center: `/api/provisioning/summary` → 200
- Automation Center rules: `/api/automation/rules` → 200
- Automation Center summary: `/api/automation/summary` → 200
- RouterOS Read-Only Lab identity: `/api/routeros/identity` → 200
- RouterOS Read-Only Lab system: `/api/routeros/system` → 200
- Inventory Sync status: `/api/inventory-sync/status` → 200
- Inventory Sync snapshot: `/api/inventory-sync/snapshot` → 200
- NOC summary: `/api/noc/summary` → 200
- NOC health: `/api/noc/health` → 200

Smoke UI en navegador con usuario temporal Super Admin:

- Dashboard visible y carga sin error.
- Clientes visible y carga sin error.
- Ficha/Client 360 visible desde cliente.
- Facturación / Planes visible y carga sin error.
- Pagos visible y carga sin error.
- Provisioning Center visible con `DRY RUN`.
- Automation Center visible con `DRY RUN`.
- RouterOS Read-Only Lab visible.
- Inventory Sync visible.
- NOC visible.
- Console del navegador sin errores JS durante el smoke.

## Seguridad

Logs recientes revisados sin imprimir secretos.

Ausente:

- JWT
- service role
- passwords
- private keys
- preshared keys
- RouterOS scripts completos
- credenciales

Runtime safety flags:

- `USE_DB_MIKROTIK`: SAFE_OFF
- `USE_DB_WIREGUARD`: SAFE_OFF
- `MIKROTIK_WORKER_LIVE`: SAFE_OFF
- `MIKROTIK_COMMIT_MODE`: SAFE_OFF
- `MIKROTIK_WRITE_ENABLED`: SAFE_OFF

## Resultado final

✅ ARCH-1 + ARCH-1.1 APROBADAS.

No avanzar a Notification Engine.
No avanzar a Worker.
No tocar RouterOS.
No tocar routers reales.
