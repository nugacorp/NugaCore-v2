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

