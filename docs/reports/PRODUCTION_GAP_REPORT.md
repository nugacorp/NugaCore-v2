# NugaCore — Production Gap Report

> **Fecha UTC:** 2026-07-15  
> **Alcance:** auditoría formal pre-producción WISP (repo + staging live + validadores).  
> **Sanitizado:** sin contraseñas, tokens, JWTs ni secretos.  
> **Staging URL:** `https://nugacore-staging.5.180.151.109.sslip.io`  
> **Supabase staging ref:** `elshnzkceutvjzxvzqad`  
> **HEAD auditado (rama desplegada):** `b66e0b1` — `cursor/owner-console-cleanup-cb99`  
> **HEAD `main` al cierre:** `cebcc6d` (UI scrollbars; PR #31 pendiente merge)

---

## Resumen ejecutivo

**Veredicto: NO listo para producción real de WISP.**

NugaCore está **maduro para staging/lab** con persistencia mixta en Supabase, auth JWT real, runtime endurecido y flujos operativos (CRM, billing, routers, WireGuard, enrollment). El endpoint oficial `/api/system/production-readiness` responde **`readyForProduction: false`** con **3 blockers** y **1 warning**.

El validador local `node scripts/validate-production-readiness.mjs` en el **Cloud Agent** falla porque **no tiene `.env` de staging** (0 `USE_DB_*`). Eso **no contradice** staging: en el contenedor Coolify **todos los `USE_DB_*` críticos están en `true`**.

| Área | Estado |
|------|--------|
| Staging operativo | **Parcial — OK para lab** |
| Producción formal | **Bloqueado** |
| UI WISP (limpieza reciente) | **Listo en staging** |
| Supabase RLS | **Listo** (jul 2026) |
| RBAC backend fino | **Parcial — gaps detectados** |
| Storage Supabase | **Bloqueado** (0 buckets) |
| Backups producción | **Bloqueado** |
| MikroTik live | **Bloqueado** (live ON en staging por diseño lab) |

---

## 1. Checks automatizados (repo)

| Check | Resultado | Evidencia |
|-------|-----------|-----------|
| `npm run build` | **PASS** | Vite + `dist/server.cjs` OK |
| `npm test` | **1923 PASS / 9 FAIL** | 98.5%; 5 archivos (NOC async, dashboard strings) |
| `npm run lint` | **2 errors, 114 warnings** | No bloquea build; corregir antes CI estricto |
| `npm run typecheck` | **PASS** (con TS en tests legacy) | Errores solo en tests NOC/inventory async |
| `node scripts/validate-production-readiness.mjs` (local sin `.env`) | **6 OK / 10 FAIL** | Esperado en agente sin secrets |
| `node scripts/staging-production-audit.mjs` (contenedor staging) | **Ejecutado** | Ver §3–§6 |

---

## 2. Validador local vs staging (aclaración Hermes)

Hermes reportó **9 FAIL** en `/root/work/NugaCore-v2` **sin variables de entorno**. Reproducido en Cloud Agent:

```
❌ Supabase configurado
❌ USE_DB_CUSTOMERS … USE_DB_SUSPENSION (7 flags)
❌ Runtime endurecido
❌ Restore probado
```

En **contenedor staging Coolify** (2026-07-15):

| Variable | Valor staging |
|----------|---------------|
| `USE_DB_CUSTOMERS` … `USE_DB_SUPPORT` | **true** (7/7) |
| `USE_DB_MIKROTIK` / `USE_DB_WIREGUARD` / `USE_DB_ROUTER_ENROLLMENT` | **true** |
| `PUBLIC_DEPLOYMENT` | **true** |
| `AUTH_TRUST_HEADERS` | **false** |
| `STAGING_RESTORE_TESTED` | **true** |
| `PRODUCTION_RESTORE_TESTED` | **(unset)** |
| `MIKROTIK_WORKER_LIVE` | **true** (lab) |
| `MIKROTIK_WORKER_COMMIT` | **false** |
| `WEBHOOK_SECRET_MANUAL` | **(unset)** |
| `CORS_ALLOWED_ORIGINS` | **(unset)** |
| `VITE_ENABLE_QUICK_LOGIN` | **true** |

**Conclusión:** el FAIL local es **artefacto del entorno**, no del estado de staging.

---

## 3. `/api/system/production-readiness` (staging live)

```json
{
  "readyForProduction": false,
  "blockers": ["mikrotik_live_off", "mikrotik_db_off", "webhook_secrets"],
  "warnings": ["cors_allowlist"]
}
```

| Gate | Staging | Interpretación |
|------|---------|----------------|
| Supabase configurado + reachable | ✅ | Backend conecta a Supabase |
| Persistencia crítica 7/7 | ✅ | Todos los `USE_DB_*` core activos |
| Sin fallback store (core) | ✅ | `storeFallbackActive=false` |
| `AUTH_TRUST_HEADERS=false` | ✅ | JWT Supabase obligatorio |
| Runtime endurecido | ✅ | `PUBLIC_DEPLOYMENT=true` |
| Restore probado | ✅ | `STAGING_RESTORE_TESTED=true` |
| Consistencia KPIs | ✅ | `/api/system/data-consistency` healthy |
| Portal JWT (no staging token) | ✅ | Modo `jwt` |
| **`MIKROTIK_WORKER_LIVE` off** | ❌ | Live **activo** en staging (lab) |
| **`USE_DB_MIKROTIK` off** | ❌ | Gate exige OFF hasta validación Hermes formal |
| **Webhook secrets** | ❌ | Falta `WEBHOOK_SECRET_MANUAL` con pagos en DB |
| CORS allowlist | ⚠️ | `CORS_ALLOWED_ORIGINS` vacío |

---

## 4. Persistencia por dominio (staging)

Fuente: `/api/health` + probes REST Supabase + APIs autenticadas.

| Dominio | `USE_DB_*` | En `domainsOnDb` | API smoke | Restart validado |
|---------|------------|------------------|-----------|----------------|
| Clientes | true | ✅ | 200, 4 rows | **Parcial** — no probado en esta auditoría |
| Planes | true | ✅ | 200, 5 rows | Parcial |
| Billing | true | ✅ | 200, 5 invoices | Parcial |
| Payments | true | ✅ | (en domainsOnDb) | Parcial |
| Suspension | true | ✅ | policies/events en DB | Parcial |
| Inventory | true | ✅ | `/api/inventory` 200 | Parcial |
| Support/tickets | true | ✅ | `/api/tickets` 200 | Parcial |
| Commercial | true | ✅ | prospects 200 | Parcial |
| Finance | true | ✅ | CFDI status 200 | Parcial |
| MikroTik | true | ✅ | 1 router en DB | Parcial |
| WireGuard | true | — | 1 server, 11 peers | Parcial |
| Router enrollment | true | — | 1 enrollment | Parcial |

**Gap:** falta matriz formal **create → restart → read** por dominio (checklist §4 producción).

---

## 5. Supabase — migraciones, RLS, storage

| Ítem | Estado | Nota |
|------|--------|------|
| RLS deny-by-default | **Listo** | Anon: 0 filas; INSERT → `42501` |
| Service role solo backend | **Listo** | REST anon no expone datos |
| Migraciones repo (27 archivos) | **Parcial** | Julio (RLS, SNMP, WG) aplicadas en schema live |
| `schema_migrations` auditado | **Bloqueado** | Requiere `psql` + password DB |
| `SUPABASE_MIGRATIONS_SYNC.md` | **Desactualizado** | Última sync documentada jun 2026 |
| **Storage buckets** | **Bloqueado** | `GET /storage/v1/bucket` → `[]` |
| Schema drift `client_documents` | **Parcial** | Tabla legacy sin `storage_path` / CRM 360 incompleto |
| Supabase prod separado | **Bloqueado** | Solo existe staging |

---

## 6. Auth / RBAC — matriz por rol (staging live)

Script: `scripts/staging-production-audit.mjs` · JWT Supabase por usuario staging.

| Endpoint | Super Admin | Admin | Cobranza | Técnico | Soporte | Solo lectura | ¿Esperado? |
|----------|:-----------:|:-----:|:--------:|:-------:|:-------:|:------------:|:----------:|
| `GET /api/clients` | 200 | 200 | 200 | 200 | 200 | 200 | ✅ |
| `GET /api/billing/invoices` | 200 | 200 | 200 | **200** | **200** | **200** | ⚠️ Técnico/Soporte/RO deberían 403 |
| `GET /api/finance/cfdi/status` | 200 | **200** | 200 | **200** | **200** | **200** | ⚠️ Admin/Técnico/Soporte/RO → 403 esperado |
| `GET /api/mikrotik/routers` | 200 | **200** | 403 | 200 | **200** | **200** | ⚠️ Admin/Soporte/RO → 403 esperado |
| `GET /api/wireguard/servers` | 200 | 200 | 403 | 200 | 403 | 403 | ✅ |
| `GET /api/inventory` | 200 | 200 | **200** | 200 | 200 | **200** | ⚠️ Cobranza/RO → revisar |
| `GET /api/tickets` | 200 | 200 | **200** | 200 | 200 | **200** | ⚠️ Cobranza/RO → revisar |

**Hallazgo crítico para producción:** el frontend oculta módulos por RBAC, pero **varios endpoints devuelven 200 a roles que no deberían leer**. Antes de go-live: endurecer `requireRoles` en backend y añadir contract tests por rol.

Otros checks auth:

| Check | Staging |
|-------|---------|
| `/api/*` sin JWT | **401** (`PUBLIC_DEPLOYMENT`) |
| Helmet + CSP + HSTS | **Presente** |
| Rate limit | **Activo** (middleware) |
| Leaked-password protection (Supabase) | **No auditado** en dashboard |

---

## 7. UI / operador WISP (cambios recientes — verificado live)

| Feature | Staging |
|---------|---------|
| Campana alertas NOC (`top-alerts-bell`) | ✅ |
| Perfil único (top bar) | ✅ |
| Sin Automation / Notification Center en menú | ✅ |
| Sin simulador portal / workflows IA | ✅ |
| Owner: solo Seguridad MFA | ✅ |

---

## 8. Matriz global — listo / parcial / bloqueado

| # | Área | Estado | Prioridad |
|---|------|--------|-----------|
| 1 | Ambiente producción separado | **Bloqueado** | P0 |
| 2 | Auth/RBAC backend alineado con matriz roles | **Parcial** | P0 |
| 3 | Persistencia DB sin memoria (flags) | **Listo en staging** | P0 validar restart |
| 4 | Backups + restore producción | **Bloqueado** | P0 |
| 5 | Supabase migraciones + RLS + storage | **Parcial** | P0 |
| 6 | Billing/pagos datos reales + webhooks | **Parcial** | P1 |
| 7 | MikroTik/RouterOS live | **Bloqueado** | P0 hasta piloto |
| 8 | NOC/SNMP/inventario real | **Parcial** | P1 |
| 9 | Observabilidad (métricas DB/workers/alertas) | **Parcial** | P1 |
| 10 | Portal / PWA técnico producción | **Parcial** | P1 |
| 11 | Documentación handoff al HEAD | **Parcial** | P2 |
| 12 | CI (lint/tests verdes) | **Parcial** | P1 |

---

## 9. Gates duros antes de go-live (orden recomendado)

1. **Proyecto Supabase producción** + Coolify prod + dominio HTTPS + secretos rotados.
2. **RBAC backend:** contract tests por rol; corregir endpoints §6.
3. **`WEBHOOK_SECRET_MANUAL`** + prueba idempotencia webhooks.
4. **`CORS_ALLOWED_ORIGINS`** con dominio final.
5. **`PRODUCTION_RESTORE_TESTED=true`** tras restore smoke en ambiente separado.
6. **Storage buckets** + migración evolutiva `client_documents`.
7. **Restart matrix** por dominio crítico documentada con PASS/FAIL.
8. **`MIKROTIK_WORKER_LIVE=false`** en prod hasta autorización; **`USE_DB_MIKROTIK`** solo tras Hermes DB-1.
9. Merge PRs pendientes (#31 UI cleanup) → deploy `main` taggeado.
10. Corregir **9 tests** fallidos + **2 lint errors**.

---

## 10. Primer uso real permitido (modo acotado)

Según checklist interno §18, se puede acercar a operación **manual/read-only** si:

- Sin Worker live / sin commit mode en producción
- Auth JWT + RBAC backend corregido
- Datos reales auditados (clientes/planes/facturas)
- Backups/restore probados
- RouterOS real solo CHR/lab autorizado

**No** incluye: automatización RouterOS, notificaciones WhatsApp live, CFDI real, ni portal masivo sin JWT cliente.

---

## 11. Comandos de reproducción

```bash
# Local (requiere .env staging o fallará USE_DB_*)
node scripts/validate-production-readiness.mjs

# Staging remoto (requiere JWT)
APP_URL=https://nugacore-staging.5.180.151.109.sslip.io \
  AUTH_BEARER=<jwt-superadmin> \
  node scripts/validate-production-readiness.mjs

# Auditoría completa (VPS, dentro del contenedor)
set -a; . /root/nugacore-staging-secrets.env; set +a
docker exec -e SUPABASE_URL -e STAGING_AUTH_PASSWORD \
  -e VITE_SUPABASE_ANON_KEY <container> node /tmp/audit.mjs

# Calidad repo
npm run typecheck && npm test && npm run build
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health/live
```

---

## 12. Resultado final

| Pregunta | Respuesta |
|----------|-----------|
| ¿Listo para producción WISP? | **NO** |
| ¿Listo para staging/lab? | **SÍ**, con caveats RBAC + MikroTik live |
| ¿Coincide con auditoría Hermes? | **SÍ** en gates duros; staging **supera** el validador local en `USE_DB_*` |
| ¿Siguiente paso? | Cerrar gaps P0 (§9) + PR RBAC backend |

**Estado documento:** `PRODUCTION_GAP_REPORT` — **NO APROBADA** para go-live producción.

---

*Generado por auditoría Cloud Agent 2026-07-15. Re-ejecutar tras cambios de flags, migraciones o deploy.*
