# NugaCore — Runbook de despliegue STAGING (Hermes + Coolify)

> **Para:** el agente **Hermes**, que vive **dentro del VPS** y ejecuta los comandos allí.
> **Claude Code NO instala nada en el VPS.** Hermes lo hace. **GitHub es el puente** entre la PC de desarrollo y el VPS.
> Objetivo: desplegar NugaCore como **staging** en **Coolify**, tomando el repo de `origin/main`.

---

## 0. Modelo de operación

```
PC (VS Code + Claude Code) ──push──► GitHub (origin/main) ──clona/deploy──► VPS (Hermes + Coolify)
```
- Claude Code prepara repo, scripts y docs (esto).
- Hermes clona el repo en el VPS y opera Coolify.
- Coolify construye la imagen con el `Dockerfile` y la corre.

---

## 1. Clonar el repo (en el VPS)
```bash
git clone https://github.com/nugacorp/NugaCore-v2.git
cd NugaCore-v2
git checkout main && git pull
git rev-parse --short HEAD   # anota el commit que vas a desplegar
```

## 2. Preflight (verificación, no modifica nada)
```bash
bash scripts/vps/preflight.sh
```
- Debe terminar en `RESULTADO: OK`. Si hay `FAIL`, corrige antes de seguir.
- Verifica: docker, docker compose, git, curl, acceso a GitHub/internet, Coolify corriendo, puerto, disco/memoria, y que `.env` no esté versionado.

## 3. Confirmar Coolify activo
```bash
docker ps --format '{{.Names}}' | grep -i coolify
```
- Debe listar contenedores de Coolify (proxy, etc.). Si no, inicia/recupera Coolify antes de continuar.

## 4. Crear / verificar la app en Coolify
En la UI de Coolify:
1. **+ New Resource → Application**.
2. Fuente: **Public Repository** (o GitHub App) → URL: `https://github.com/nugacorp/NugaCore-v2.git`.
3. **Branch:** `main`.
4. **Build Pack:** **Dockerfile** (usa el `Dockerfile` del repo; NO nixpacks).
5. **Port (interno del contenedor):** `3000`.
6. **Health check path:** `/api/health/live` (interval 30s, timeout 5s, start period ~20s).
7. Asigna el **dominio** de staging (Coolify gestiona TLS/Let's Encrypt) y activa **Force HTTPS**.

## 5. Variables de entorno en Coolify (Tarea 6)

> ⚠️ **Pega los secretos en los campos de Coolify (Secrets), nunca en el repo.** No imprimas los valores.

### Runtime (no build)
```
NODE_ENV=production
PORT=3000
AUTH_TRUST_HEADERS=true
USE_DB_CUSTOMERS=true
SUPABASE_URL=https://elshnzkceutvjzxvzqad.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<PEGAR_EN_COOLIFY_SECRET>
MIKROTIK_CREDENTIALS_KEY=<GENERAR_SECRETO_LARGO>   # p.ej.: openssl rand -base64 48
LOG_LEVEL=info
LOG_FORMAT=json
```

### Build-time (marcar como **Build Variable** en Coolify; se incrustan en el bundle)
```
VITE_SUPABASE_URL=https://elshnzkceutvjzxvzqad.supabase.co
VITE_SUPABASE_ANON_KEY=<PEGAR_EN_COOLIFY_BUILD_SECRET>
```

### Notas de seguridad
- `SUPABASE_SERVICE_ROLE_KEY` es de **servidor**: jamás como `VITE_*` ni en el frontend.
- `VITE_SUPABASE_ANON_KEY` sí va al frontend (build), pero no se imprime innecesariamente.
- `.env` **nunca** se commitea. Los valores secretos se obtienen del dashboard de Supabase del proyecto `elshnzkceutvjzxvzqad` (Project Settings → API).

### ⚠️ Aclaración importante sobre `AUTH_TRUST_HEADERS` (Fase 2 ya aplicada)
NugaCore ya tiene **auth real (JWT de Supabase)**. Con el endurecimiento de Fase 2:
- En **`NODE_ENV=production` los trusted-headers se IGNORAN SIEMPRE**, sin importar `AUTH_TRUST_HEADERS`.
- Por lo tanto `AUTH_TRUST_HEADERS=true` en staging es **efectivamente un no-op**: la identidad sale del **JWT de Supabase**.
- **Lecturas** (`GET /api/clients`, dashboard) están abiertas y cargan sin login.
- **Escrituras** (crear/editar cliente) exigen **login real**. Ya existen 6 usuarios de staging sembrados (`superadmin@nugacore.local`, `admin@`, `cobranza@`, `tecnico@`, `soporte@`, `lectura@` `nugacore.local`); el password lo tiene el dueño (variable `STAGING_AUTH_PASSWORD` de su `.env` local) o se restablece desde el dashboard de Supabase.
- Conclusión: puedes dejar `AUTH_TRUST_HEADERS=true` (lo pidió el dueño) — no afecta producción. Para limpieza futura, en producción final debe quedar `false`.

## 6. Deploy
- En Coolify pulsa **Deploy**. Coolify ejecuta el `Dockerfile`:
  - build stage: `npm ci` + `npm run build` → `dist/` (frontend) + `dist/server.cjs`.
  - runtime stage: `npm ci --omit=dev`, `USER node`, `CMD node dist/server.cjs`, puerto `3000`.

## 7. Revisar logs
- En Coolify, pestaña **Logs** de la app. Debe verse `NugaCore server running ... mode=production`.
- Confirma que **no aparezcan secretos** en logs (las keys nunca se loguean; `LOG_FORMAT=json`).

## 8. Validación post-deploy
Desde el VPS (o donde haya `curl`), con el dominio público:
```bash
APP_URL=https://<tu-dominio-staging> bash scripts/vps/validate-staging.sh
```
- Debe terminar en `RESULTADO: PASS`.
- Valida `/api/health`, `/live`, `/ready`, `/api/clients` y que `persistence=mixed` con `customers`.
- Alta de cliente de prueba (opcional, requiere JWT por Fase 2):
  ```bash
  APP_URL=https://<dominio> CREATE_TEST_CLIENT=true AUTH_BEARER=<jwt-de-un-login> bash scripts/vps/validate-staging.sh
  ```

## 9. Probar rollback
- En Coolify → pestaña **Deployments**: cada deploy queda registrado.
- Pulsa **Rollback/Redeploy** sobre el despliegue estable anterior y confirma que la app vuelve a responder (`/api/health/live`).
- Documenta que el rollback funcionó.

## 10. Documentar resultado
- Copia `docs/COOLIFY_STAGING_RESULT_TEMPLATE.md`, rellénalo y guárdalo (p.ej. `docs/COOLIFY_STAGING_RESULT.md`) **sin secretos**.
- Marca el `docs/COOLIFY_STAGING_CHECKLIST.md`.

---

## Recordatorios
- **Claude Code no instala en el VPS. Hermes sí. GitHub es el puente.**
- No subir `.env`. No exponer secretos en logs ni en el repo. No `force-push`.
- Para actualizar el deploy: `git push` desde la PC → Coolify auto-deploy (si está activado) **tras CI verde**, o **Deploy** manual en Coolify.
