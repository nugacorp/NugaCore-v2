# NugaCore v2 — Plan de Finalización del Proyecto

Fecha de auditoría: 2026-07-06
Commit base: `f8e142e` (main)
Auditable por Hermes: sí — cada etapa define evidencia, gates y criterios de salida.

---

## 1. Estado verificado (evidencia de esta auditoría)

Verificaciones ejecutadas sobre `main` el 2026-07-06:

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` (frontend) | ✅ Sin errores |
| `tsc --noEmit -p tsconfig.backend.json` | ✅ Sin errores |
| `eslint .` | ✅ 0 errores · 104 warnings (`no-explicit-any`, TD-04) |
| `vitest run` | ✅ 148 files passed / 8 skipped · **1769 tests passed** / 49 skipped (8.9s) |
| `vite build` + `esbuild server.ts` | ✅ Compilan ambos targets. ⚠️ chunk frontend > 500 kB (falta code-splitting) |
| Migraciones Supabase | ✅ 16/16 usan patrones idempotentes (`IF NOT EXISTS` / `CREATE OR REPLACE` / `ON CONFLICT`) |
| RLS | ✅ Presente en migraciones de dominios sensibles |
| Secretos | ✅ `.env` nunca versionado (historial git limpio); sin secretos hardcodeados en `backend/`, `src/`, `server.ts` |
| Fail-fast producción | ✅ `validateEnvironment()` aborta arranque si `AUTH_TRUST_HEADERS=true`, falta `MIKROTIK_CREDENTIALS_KEY` o falta Supabase |
| Borde HTTP | ✅ helmet + CSP (prod), CORS allowlist, rate limit general + estricto en `/api/auth`, `trust proxy 1` |
| Gates peligrosos | ✅ `MIKROTIK_WORKER_LIVE` gated (default false); commit mode inexistente en código; providers RouterOS caen a mock |

Conclusión: la base técnica está sana. Lo que "falta para finalizar" no es código roto,
sino (a) cerrar validaciones Hermes pendientes, (b) completar la migración store→DB por
flags, (c) las fases gated del roadmap hasta provisioning real, y (d) pagar deuda
técnica estructural que limita escalabilidad.

---

## 2. Hallazgos por área

### 2.1 Seguridad — sólida, con 3 pendientes

Bien: fail-fast en prod, RBAC + tests RBAC por dominio, redacción de secretos
(`secret-redaction`, `sanitize-sensitive-data` con tests), auditoría de seguridad,
rate limiting, CSP, RLS, migraciones idempotentes, `.env` fuera de git.

Pendiente:

- **SEC-1** · HOTFIX-PAYMENTS-AUTH: falta redeploy + smoke test de Hermes y
  verificación de host key SSH (`docs/PAYMENTS_AUTH_HEADERS_HOTFIX_RESULT.md`).
- **SEC-2** · Rate limit en memoria: con más de una réplica detrás de Coolify el
  límite se diluye por proceso. Documentar como limitación o mover a store compartido
  cuando haya escalado horizontal.
- **SEC-3** · Rotación periódica de `SUPABASE_SERVICE_ROLE_KEY` y
  `MIKROTIK_CREDENTIALS_KEY` sin procedimiento documentado. Crear runbook.

### 2.2 Implementación / funcionalidad

Operativas y aprobadas: Core, Clientes, Planes, Billing, Payment Engine (dry-run
proveedor), Service Status SSOT, Provisioning Foundation (PROD-7), Notification
Foundation (PROD-9), ARCH-1, Router Enrollment + snapshots, DB-1, Inventory
Read-Only 4.11.1, NOC Read-Only 4.11.2/4.11.3.

Code-complete pero **sin validación Hermes** (bloquean avanzar según regla "no avanzar
sin cerrar el anterior"): PROD-8 Automation (sin `STAGING_RESULT`), PROD-1 Manual Safe
Mode*, FAST-1 Safe Command Queue, PROD-3 RouterOS Read-Only Lab, PROD-4 CHR Real
Read-Only (con CHR de lab), UX-1, WISP-CORE-1, CUSTOMER-IPAM-1 (metadatos
`routerId`/`poolId`/`ipAssignmentStatus` sin persistencia DB), USE_DB_INVENTORY.

*Inconsistencia documental: `ROADMAP.md` marca PROD-1 "✅ Aprobada por Hermes" pero
`docs/PROJECT_STATUS_CURRENT.md` la lista "🟡 pendiente Hermes". Reconciliar (DOC-1).

No iniciados: PROD-10 Worker Dry-Run (gated, requiere autorización de Ramiro),
PROD-5/6 comando real CHR, 4.9.3 Real Provisioning, NOC completo con alertas,
Inventario operación real, Tickets, CRM comercial, Portal cliente, Mobile, IA.

### 2.3 Orden y estructura

Bien: dominios backend consistentes (routes/service/repository/mappers/types), flags
`USE_DB_*` centralizadas, capa `core/` repository, 158 archivos de test (contract +
unit + RBAC + static-safety), docs exhaustivas.

Deuda (de `docs/TECHNICAL_DEBT.md`, confirmada en esta auditoría):

- **TD-03** God components: `CrmModule.tsx` 1905 líneas, `App.tsx` 1354,
  `RouterOsResourcesModule.tsx` 1262, `FinanceOwnerModule.tsx` 1090, `GisModule.tsx` 1068.
- **TD-04** 104 warnings `any`.
- **TD-01/TD-12** `backend/state/store.ts` (889 líneas) global mutable aún es la
  fuente para dominios sin flag DB activada.
- **TD-10** Backend importa tipos del frontend.
- Higiene menor: `.tmp_claude_debug.log` (1.1 MB) y `vitest.config.ts.timestamp-*.mjs`
  residen en el working tree (ya ignorados; borrar localmente).

### 2.4 Escalabilidad

- Frontend: un solo chunk > 500 kB → lazy-loading por módulo (`React.lazy` por sección
  del sidebar) es la mejora de mayor impacto/costo.
- Backend: dominios sobre store en memoria no sobreviven reinicios ni escalan a >1
  réplica → completar migración por flags `USE_DB_*` es el camino ya diseñado.
- Rate limit y stores de workers en memoria: mismo límite de réplica única (SEC-2).

---

## 3. Plan de finalización por etapas

Regla transversal: cada etapa termina con `npm run lint && npm run typecheck &&
npm run test && npm run build` en verde, documento `*_RESULT.md`, validación Hermes en
staging cuando aplique, y sin activar `MIKROTIK_WORKER_LIVE`, commit mode ni routers
reales salvo autorización explícita.

### Etapa 0 — Higiene y reconciliación documental (½ día, sin riesgo)

- DOC-1: reconciliar estado PROD-1 entre `ROADMAP.md` y `PROJECT_STATUS_CURRENT.md`.
- Borrar `.tmp_claude_debug.log` y `vitest.config.ts.timestamp-*.mjs` locales.
- Runbook SEC-3 (rotación de claves) en `docs/`.
- Salida: docs consistentes; sin cambios de código.

### Etapa 1 — Cerrar validaciones Hermes pendientes (1–2 semanas, bloqueante)

Orden estricto (el ya definido en `PROJECT_STATUS_CURRENT.md`):

1. SEC-1: redeploy + smoke HOTFIX-PAYMENTS-AUTH.
2. PROD-8 Automation → generar `AUTOMATION_ENGINE_FOUNDATION_STAGING_RESULT.md`.
3. PROD-1 Manual Safe Mode (si DOC-1 confirma que falta).
4. FAST-1 Safe Command Queue dry-run.
5. PROD-3 RouterOS Read-Only Lab (mock).
6. PROD-4 CHR Real Read-Only contra CHR de lab (solo lectura, gated por env).
7. UX-1, WISP-CORE-1, USE_DB_INVENTORY en staging.

- Salida: todo lo code-complete con veredicto Hermes; ningún 🟡 residual.

### Etapa 2 — Persistencia DB completa por flags (2–3 semanas)

- Persistir metadatos CUSTOMER-IPAM-1 (`routerId`, `poolId`, `ipAssignmentStatus`)
  con migración idempotente nueva.
- Migrar dominios restantes de `state/store.ts` a repository/DB detrás de su
  `USE_DB_*` (dual-mode store/DB siempre disponible, como exige la regla del proyecto).
- Gate por dominio: tests contract en ambos modos (flag on/off) + staging Hermes.
- Salida: reinicio de proceso sin pérdida de estado en todos los dominios core;
  TD-01/TD-12 saldadas.

### Etapa 3 — PROD-10 Worker Engine Dry-Run (requiere autorización explícita de Ramiro)

- Motor de ejecución en simulación: plan → preview de comandos → resultado mock.
- Sin `MIKROTIK_WORKER_LIVE`, sin RouterOS Write, gated por flag propia.
- Tests static-safety que prueben que ningún camino llega a escritura real.
- Salida: `WORKER_ENGINE_DRYRUN_RESULT.md` + staging Hermes.

### Etapa 4 — Camino a provisioning real (gated, secuencial)

PROD-5 (Safe Command Queue dry-run contra CHR) → PROD-6 (primer comando real en CHR
de lab) → piloto en router no crítico → 4.9.3 Real Provisioning. Cada paso con
autorización explícita, rollback documentado (deploy-checklist) y ventana de cambio.
Solo aquí se evalúa activar `MIKROTIK_WORKER_LIVE`, y únicamente en lab primero.

### Etapa 5 — Escalabilidad y deuda técnica (paralelizable con 2–4)

- Code-splitting frontend por módulo (elimina el warning de 500 kB).
- Trocear TD-03: extraer de `App.tsx` el routing/estado global; dividir `CrmModule`,
  `RouterOsResourcesModule`, `FinanceOwnerModule`, `GisModule` en subcomponentes.
- TD-04: reducir los 104 `any` (empezar por backend y mappers).
- TD-10: mover tipos compartidos a un paquete/carpeta `shared/`.
- SEC-2: decidir estrategia de rate limit multi-réplica.
- Salida: lint sin warnings o umbral acordado; ningún archivo > 800 líneas.

### Etapa 6 — Producción formal (cierre del proyecto)

- Pipeline CI (GitHub Actions ya hay carpeta `.github`): lint + typecheck + test +
  build obligatorios en PR; deploy Coolify con rollback documentado.
- Backups y restauración probada de Supabase (validación financiera real de Billing).
- Validación de proveedor de pagos real + webhooks + conciliación idempotente.
- Activación de notificaciones reales (provider real detrás de flag, después de PROD-9).
- NOC alertas (Telegram/email) con rate limit y datos sanitizados.
- Salida: checklist de `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md` completa; sistema
  operando con datos reales bajo los gates del ROADMAP.

Fases post-cierre (fuera de este plan): Tickets, CRM comercial completo, Portal
cliente, Mobile App, IA operativa.

---

## 4. Invariantes (no negociables, de `.claude`/ROADMAP)

No romper contratos API; tests en toda fase; typecheck + build siempre; compatibilidad
hacia atrás; seguridad primero; **no** `MIKROTIK_WORKER_LIVE`, **no** commit mode,
**no** routers reales, **no** `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`, **no** aplicar
`20260605000000_mikrotik_provisioning_schema.sql` tal cual — todo sin autorización
explícita de Ramiro; toda fase auditable por Hermes; toda migración idempotente;
todo dominio dual store/DB por feature flag.
