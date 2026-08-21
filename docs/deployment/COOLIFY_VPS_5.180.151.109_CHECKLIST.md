# NugaCore — Checklist Coolify VPS `5.180.151.109`

> **VPS:** `5.180.151.109` · **Staging:** `https://nugacore-staging.5.180.151.109.sslip.io`  
> **Repo:** `https://github.com/nugacorp/NugaCore-v2.git`  
> **Rama a desplegar (WISP OS + producción real):** `cursor/wisp-os-master-plan-0ffb` (PR #7) → `main` tras merge  
> **Fecha plantilla:** 2026-07-09

Usa este documento en la UI de Coolify (Environment Variables + Deploy). **No pegues secretos en Git** — solo en Coolify como *Secret*.

---

## 1. App Coolify (staging)

| Campo | Valor |
|-------|--------|
| Build Pack | Dockerfile |
| Puerto interno | `3000` |
| Health check | `/api/health/live` |
| Dominio | `nugacore-staging.5.180.151.109.sslip.io` |
| Force HTTPS | ON |
| Rama | `cursor/wisp-os-master-plan-0ffb` (o `main` cuando PR #7 esté mergeado) |

- [ ] Repo conectado y rama correcta
- [ ] Build exitoso
- [ ] Contenedor healthy
- [ ] Rollback probado (Deployments → Rollback a revisión anterior)

---

## 2. Variables de entorno — Runtime (Coolify → Environment)

Copia cada clave en Coolify. Los valores `__SECRET__` los sustituyes por los de tu Supabase/Coolify vault.

### 2.1 Runtime base (obligatorio)

```env
NODE_ENV=production
PORT=3000
APP_URL=https://nugacore-staging.5.180.151.109.sslip.io

LOG_LEVEL=info
LOG_FORMAT=json

AUTH_TRUST_HEADERS=false

SUPABASE_URL=https://__PROJECT_REF__.supabase.co
SUPABASE_ANON_KEY=__SECRET__
SUPABASE_PUBLISHABLE_KEY=__SECRET__
SUPABASE_SERVICE_ROLE_KEY=__SECRET__
SUPABASE_SECRET_KEY=__SECRET__
DATABASE_URL=postgresql://postgres.__PROJECT_REF__:__PASSWORD__@aws-0-__REGION__.pooler.supabase.com:6543/postgres

MIKROTIK_CREDENTIALS_KEY=__SECRET_32_BYTES_MIN__

GEMINI_API_KEY=
VITE_ENABLE_QUICK_LOGIN=false
```

### 2.2 Persistencia OLA 0 (todos `true` en staging productivo)

```env
USE_DB_CUSTOMERS=true
USE_DB_PLANS=true
USE_DB_BILLING=true
USE_DB_PAYMENTS=true
USE_DB_SUSPENSION=true
USE_DB_INVENTORY=true
USE_DB_SUPPORT=true
USE_DB_COMMERCIAL=true
USE_DB_PURCHASES=true
USE_DB_FINANCE=true

USE_DB_NETWORK=false
USE_DB_FTTH=false
USE_DB_MIKROTIK=false
USE_DB_DASHBOARD=false
USE_DB_GIS=false
USE_DB_AUTOMATIONS=false
USE_DB_REPORTS=false
USE_DB_SECURITY=false
USE_DB_WIREGUARD=false
USE_DB_ROUTER_ENROLLMENT=true

STAGING_RESTORE_TESTED=true
```

### 2.3 Production gates — Fase A (staging seguro, dry-run)

Dejar en `false` hasta validar readiness. Activar en Fase B/C según tabla §4.

```env
NUGACORE_LIVE_MODE=false
MIKROTIK_WORKER_LIVE=false
MIKROTIK_WORKER_COMMIT=false
MIKROTIK_WORKER_API_TLS=false
NOTIFICATIONS_LIVE=false
NOTIFICATION_WEBHOOK_URL=
AUTOMATION_EXECUTE=false
PROVISIONING_EXECUTE=false
PAYMENTS_ROUTER_LIVE=false
SAFE_COMMAND_QUEUE_LIVE=false
SERVICE_STATUS_LIVE=false
```

### 2.4 HTTP / CORS / portal

```env
CORS_ALLOWED_ORIGINS=https://nugacore-staging.5.180.151.109.sslip.io
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_MAX=20
CSP_ENABLED=true
CSP_CONNECT_SRC=https://__PROJECT_REF__.supabase.co

PORTAL_STAGING_TOKEN=
ROUTEROS_READONLY_PROVIDER=mock
IPAM_PROVIDER=mock
```

### 2.5 Pagos (opcional — Fase B)

```env
MP_ACCESS_TOKEN=__SECRET__
WEBHOOK_SECRET_MERCADO_PAGO=__SECRET__
WEBHOOK_SECRET_OPENPAY=__SECRET__
```

> El nombre lleva guion bajo entre `MERCADO` y `PAGO`. El backend resuelve el
> secreto como `WEBHOOK_SECRET_${provider.toUpperCase()}` y el proveedor
> interno es `mercado_pago`, asi que un nombre sin guion bajo no lo lee nadie:
> en runtime endurecido el webhook responde 503 y los cobros se rompen en
> silencio. La ruta HTTP `/api/payments/webhook/mercadopago` SI va sin guion
> bajo; es una ruta, no una variable.

- [ ] `AUTH_TRUST_HEADERS=false` confirmado en contenedor (`docker exec … env | grep AUTH`)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` **no** están como `VITE_*`
- [ ] `PORTAL_STAGING_TOKEN` vacío (portal solo JWT en staging productivo)

---

## 3. Variables Build-time (Coolify → marcar **Build Variable**)

Requieren **rebuild** tras cambio.

```env
VITE_SUPABASE_URL=https://__PROJECT_REF__.supabase.co
VITE_SUPABASE_ANON_KEY=__SECRET__
VITE_SUPABASE_PUBLISHABLE_KEY=__SECRET__
```

- [ ] Las tres `VITE_*` marcadas como Build Variable en Coolify
- [ ] Rebuild ejecutado después de actualizar claves Supabase

---

## 4. Orden de activación — producción real (gates)

| Fase | Cuándo | Variables a `true` | Validación |
|------|--------|-------------------|------------|
| **A** | Siempre primero | Solo `USE_DB_*` + `STAGING_RESTORE_TESTED` | `production-readiness` → `readyForLiveWisp: true` |
| **B** | Cobranza operativa | `PAYMENTS_ROUTER_LIVE`, `SERVICE_STATUS_LIVE` | Pago test → orden reactivación en DB |
| **C** | Comunicaciones | `NOTIFICATIONS_LIVE` + `NOTIFICATION_WEBHOOK_URL` | Simular notificación → webhook recibido |
| **D** | Automatización | `AUTOMATION_EXECUTE`, `PROVISIONING_EXECUTE` | Automation simulate → decisión ejecutada |
| **E** | Red MikroTik | `MIKROTIK_WORKER_LIVE` → luego `MIKROTIK_WORKER_COMMIT` | Solo CHR/lab; checklist §11 |
| **F** | Master | `NUGACORE_LIVE_MODE=true` | Equivale a activar todos los gates |

**Nunca** activar Fase E en routers de producción sin autorización explícita.

---

## 5. Deploy en Coolify (paso a paso)

1. Coolify → App NugaCore staging → **Source** → rama `cursor/wisp-os-master-plan-0ffb`
2. **Environment** → pegar variables §2 y §3 (secretos en campos Secret)
3. **Deploy** → esperar build + health `200` en `/api/health/live`
4. Si cola atascada (histórico VPS):
   ```bash
   # En el host Coolify, según tu instalación:
   php artisan check:deployment-queue --force --seconds=0
   php artisan cleanup:deployment-queue
   ```
5. Anotar commit desplegado: `git rev-parse --short HEAD` en logs de build

- [ ] Deploy completado sin error
- [ ] Commit anotado: `__________`

---

## 6. Validación post-deploy (con JWT Supabase)

Obtén un JWT de usuario staging (Super Admin) desde el login de la app o Supabase Auth.

```bash
export APP_URL="https://nugacore-staging.5.180.151.109.sslip.io"
export TOKEN="__JWT_SUPABASE__"

# Health
curl -sS "$APP_URL/api/health/live"

# OLA 0
curl -sS -H "Authorization: Bearer $TOKEN" "$APP_URL/api/system/persistence-status" | jq '.storeFallbackActive, .criticalOnCount'
curl -sS -H "Authorization: Bearer $TOKEN" "$APP_URL/api/system/staging-readiness" | jq '.ola0PersistenceClosed, .checklist.restore_tested'
curl -sS -H "Authorization: Bearer $TOKEN" "$APP_URL/api/system/data-consistency" | jq '.healthy'

# Producción real — readiness
curl -sS -H "Authorization: Bearer $TOKEN" "$APP_URL/api/system/production-readiness" | jq '.readyForLiveWisp, .blockers'

# Gates (deben estar false en Fase A)
curl -sS -H "Authorization: Bearer $TOKEN" "$APP_URL/api/system/production-gates" | jq '.gates'

# Job auditoría
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"job":"persistence-audit"}' "$APP_URL/api/jobs/run"
```

### Criterios PASS (Fase A)

| Endpoint | Esperado |
|----------|----------|
| `persistence-status` | `storeFallbackActive: false`, `criticalOnCount: 7` |
| `staging-readiness` | `ola0PersistenceClosed: true`, `restore_tested: true` |
| `data-consistency` | `healthy: true` |
| `production-readiness` | `readyForLiveWisp: true`, `blockers: []` |
| `production-gates` | `liveMode: false`, `mikrotikWorkerCommit: false` |

- [ ] Todos los criterios PASS anotados con fecha/hora

---

## 7. Scripts en el VPS (SSH)

```bash
ssh root@5.180.151.109   # o el usuario configurado

cd /opt/NugaCore-v2 || cd ~/NugaCore-v2 || cd /srv/NugaCore-v2
git fetch origin
git checkout cursor/wisp-os-master-plan-0ffb
git pull origin cursor/wisp-os-master-plan-0ffb

bash scripts/vps/preflight.sh

# Con credenciales Supabase en el shell del VPS:
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
STRICT_STAGING=1 node scripts/validate-staging-readiness.mjs
RUN_DB_TESTS=true node scripts/validate-wisp-os-staging.mjs
node scripts/validate-restore-checklist.mjs

APP_URL="https://nugacore-staging.5.180.151.109.sslip.io" bash scripts/vps/validate-staging.sh
```

- [ ] `preflight.sh` OK
- [ ] `STRICT_STAGING=1 validate-staging-readiness` exit 0
- [ ] `validate-wisp-os-staging` tablas OK

---

## 8. Migraciones Supabase (si faltan tablas)

En el VPS (con `SUPABASE_ACCESS_TOKEN` o `DATABASE_URL`):

```bash
bash scripts/apply-wisp-os-migrations.sh
```

Migraciones esperadas:

- `20260707000000_crm_erp_wisp_schema.sql`
- `20260707100000_wisp_os_schema.sql`
- `20260707120000_ola6_radius_tenancy.sql`
- `20260708100000_portal_user_bindings.sql` (si aplica)

- [ ] Tablas `client_tags`, `payment_promises`, `portal_user_bindings` accesibles

---

## 9. Cron operativo (opcional — Fase B+)

Programar en Coolify / cron del host o llamada externa:

```bash
# Cada hora: evaluar morosos + worker (solo si gates activos)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"job":"suspension-cycle"}' "$APP_URL/api/jobs/run"
```

- [ ] Job `suspension-cycle` probado manualmente
- [ ] Cron configurado (si aplica)

---

## 10. Evidencia a guardar

1. Commit desplegado (`__________`)
2. Captura `production-readiness` con `readyForLiveWisp: true`
3. Resultado `validate-staging.sh`
4. Confirmación backup+restore (`STAGING_RESTORE_TESTED=true`)
5. Rollback probado en Coolify

---

## Referencias

- Flags detallados: [`STAGING_FLAGS_WISP_OS.md`](./STAGING_FLAGS_WISP_OS.md)
- Plantilla prod: [`.env.production.example`](../.env.production.example)
- Bitácora VPS: [`VPS_5.180.151.109_EJECUCION_2026-07-08.md`](../reports/VPS_5.180.151.109_EJECUCION_2026-07-08.md)
- Mapa módulos: [`WISP_OS_MODULE_MAP.md`](../planning/WISP_OS_MODULE_MAP.md)
- PR implementación: https://github.com/nugacorp/NugaCore-v2/pull/7
