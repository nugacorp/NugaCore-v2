# NugaCore — Checklist de deploy STAGING (Coolify)

> Marca cada casilla. Referencia: [HERMES_COOLIFY_STAGING_RUNBOOK.md](HERMES_COOLIFY_STAGING_RUNBOOK.md).

## Preparación
- [ ] Repo GitHub `origin/main` actualizado (commit anotado: `__________`)
- [ ] Hermes activo en el VPS
- [ ] Coolify activo (`docker ps | grep -i coolify`)
- [ ] `bash scripts/vps/preflight.sh` → RESULTADO: OK

## App en Coolify
- [ ] App creada en Coolify
- [ ] Repo conectado (`https://github.com/nugacorp/NugaCore-v2.git`)
- [ ] Rama `main` seleccionada
- [ ] Build Pack = **Dockerfile**
- [ ] Puerto interno = `3000`
- [ ] Health check path = `/api/health/live`
- [ ] Dominio + TLS (Force HTTPS) configurado

## Variables
- [ ] Runtime configuradas (ver [`COOLIFY_VPS_5.180.151.109_CHECKLIST.md`](COOLIFY_VPS_5.180.151.109_CHECKLIST.md) §2)
- [ ] Build-time configuradas (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) marcadas como Build Variable
- [ ] `SUPABASE_SERVICE_ROLE_KEY` **NO** está como `VITE_*` / no llega al frontend

## Deploy y verificación
- [ ] Build exitoso en Coolify
- [ ] Contenedor levantado (`node dist/server.cjs`)
- [ ] Healthcheck OK (`/api/health/live` 200)
- [ ] Frontend carga en el dominio
- [ ] API responde (`/api/health`)
- [ ] Customers desde Supabase responde (`/api/clients` 200; `persistence=mixed` con `customers`)
- [ ] `bash scripts/vps/validate-staging.sh` → RESULTADO: PASS

## Seguridad y cierre
- [ ] Rollback probado (Coolify → Deployments → Rollback)
- [ ] Logs revisados
- [ ] Sin secretos en logs
- [ ] Sin secretos en Git (`.env` no versionado)
- [ ] Resultado documentado (ver plantilla)
