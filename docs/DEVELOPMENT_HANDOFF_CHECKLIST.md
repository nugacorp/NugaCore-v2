# NugaCore — Development Handoff Checklist

> Documento operativo para cualquier técnico, Hermes, Jarvis o Claude Code que continúe el desarrollo.
>
> Objetivo: que nadie avance a ciegas, no se salte pruebas, no active flags peligrosos y mantenga la ruta hacia producción definida en `ROADMAP.md` y `docs/PRODUCTION_READINESS_CHECKLIST.md`.

## 0. Estado actual y siguiente tarea (LEER PRIMERO)

> Esta sección es la fuente de verdad para un agente que arranca en frío.
> Si está vacía o desactualizada, reconstruirla desde `ROADMAP.md`,
> `docs/PRODUCTION_READINESS_CHECKLIST.md` y los documentos de resultado en `docs/`.

### A. Fases cerradas / no retomar salvo regresión

Estas fases están implementadas y mergeadas en `main`. **No retomarlas salvo que exista una regresión nueva documentada.**

- WireGuard Auto Enrollment.
- Router Onboarding Wizard.
- Advanced Template Engine.
- Dynamic Template Parameters.
- Router Enrollment DB Persistence.
- `router_snapshot` persistence.
- `wireguard_snapshot` persistence.
- Payment Engine.
- Suspension Engine (lógico, sin tocar routers reales).
- Data Consistency Audit (Pre-PROD-7): `systemMetrics` SSOT por KPI + auditor
  `GET /api/system/data-consistency`; dashboard normalizado (cobranza/facturación
  del mes). Ver `docs/DATA_CONSISTENCY_AUDIT_RESULT.md`. Pendiente Hermes.
- Service Status SSOT (Pre-PROD-7): dominio `service-status` como fuente oficial de
  `serviceStatus` (ACTIVE/PENDING_INSTALL/SUSPENSION_PENDING/SUSPENDED/
  REACTIVATION_PENDING/CANCELLED). Read-only + solicitudes `dryRun` (no ejecuta
  RouterOS/Worker/MikroTik). KPI "Suspendidos" desde Service Status; Client 360
  muestra las 4 dimensiones. Static-safety guard activo. Pendiente Hermes. Ver
  `docs/SERVICE_STATUS_SSOT_RESULT.md`.
- HTTP Security (helmet + CORS allowlist + rate-limit).
- Observability básica (correlation ID, métricas in-memory, access log).
- Inventario ERP 5.1 (persistencia tras `USE_DB_INVENTORY` + UI aditiva; pendiente Hermes).
- Client 360 + Acciones rápidas en CRM (acciones seguras: navegación/modal/simulación;
  sin RouterOS/Worker; pendiente Hermes). Ver `docs/CLIENT_360_QUICK_ACTIONS_RESULT.md`.
- Billing & Collections Foundation (extensión aditiva del dominio `billing`:
  invoice/:id, cancel, balance, payments, run-cycle simulado, dashboard
  billing-kpis; Client 360 cobranza + Cobranza Ejecutiva; RBAC read(6)/write(3),
  Bearer JWT, secret scan). Mock local, sin SAT/CFDI/Stripe/MercadoPago; motor
  MikroTik intacto. Pendiente Hermes. Ver
  `docs/BILLING_COLLECTIONS_FOUNDATION_RESULT.md`.
  - **Gate de validación:** `npm run test:db:billing` (enfocado: billing + customers
    + plans). El gate global `npm run test:db` puede fallar por dominios ajenos
    (router-enrollment exige `AUTH_TRUST_HEADERS`; inventory con errores propios) y
    NO debe bloquear la aprobación de Billing. Inventory DB queda como pendiente
    separado.
- Dashboard Ejecutivo V3 (UX/UI): dashboard reducido a 8 KPIs clickeables, Alertas
  Importantes (máx. 5) y 5 Acciones Rápidas en el primer viewport; sin duplicados.
  El tooling NOC (alertas RT, ping, simulador, umbrales/push, bot) se movió a
  `NocOperationsPanel` bajo el tab NOC (no se eliminó del sistema). Sin cambios de
  tema/branding. Pendiente Hermes. Ver `docs/DASHBOARD_EXECUTIVE_V3_RESULT.md`.
- PROD-7 Provisioning Engine Foundation: dominio `provisioning` dry-run con acciones
  de suspension, reactivacion, cambio de plan, alta y baja; estados
  PENDING/VALIDATED/SIMULATED/APPROVED/REJECTED/CANCELLED; endpoints
  `/api/provisioning/*`; RBAC read(6)/write(3); UI `Provisioning Center` bajo
  MikroTik, Client 360 y KPI `Provisioning Pendiente`. No RouterOS/Worker Live.
  ✅ Validada por Hermes en staging (commit `0f1457c`). Ver
  `docs/PROVISIONING_ENGINE_FOUNDATION_RESULT.md` y
  `docs/PROVISIONING_ENGINE_FOUNDATION_STAGING_RESULT.md`.
- PROD-8 Automation Engine Foundation: dominio `automation` (decisión/dry-run).
  16 eventos, 9 decisiones, motor de reglas con `condition` puras + prioridad y
  `executionPreview` descriptivo; endpoints `/api/automation/*` (read-only +
  `POST /simulate`); auditoría sin secretos; RBAC lectura+simulación para todos
  los roles (nadie modifica reglas todavía); UI `Automation Center` bajo
  Configuración (badge DRY RUN + banner), KPI `Automation Queue`, sección
  Automation en Client 360 y `Decision Source` en Provisioning; static-safety
  test. No ejecuta nada, no RouterOS/Worker Live. 🟡 Code-complete, **pendiente
  Hermes** (commit `eb4ea0a`, aún sin `STAGING_RESULT`). Ver
  `docs/AUTOMATION_ENGINE_FOUNDATION_RESULT.md`.
- ARCH-1 Architecture Hardening: auditoría + hardening sin cambio de
  comportamiento. Dedup `nowIso` ×12 → `backend/common/time.ts`; flags
  centralizadas (`useDbWireguard()`); docs nuevos `ARCHITECTURE_AUDIT.md`,
  `ARCHITECTURE_OVERVIEW.md`, `FEATURE_FLAGS.md`, backlog priorizado en
  `TECHNICAL_DEBT.md`. Sin cambios de endpoints/payloads/RBAC/UX/tests.
  División de God Components queda como backlog (rompería tests de string).
  ✅ Validada por Hermes en staging (ARCH-1 + ARCH-1.1). Ver
  `docs/ARCH1_ARCHITECTURE_HARDENING_RESULT.md` y `docs/ARCH1_STAGING_RESULT.md`.
- PROD-9 Notification Engine Foundation: dominio `notifications` (DRY RUN /
  mock provider). 9 tipos, 5 canales, 6 estados (nunca SENT real), 8 plantillas
  con variables, 5 providers mock (`sent=false`); endpoints
  `/api/notifications/*` (preview/create/simulate/cancel — sin /send ni
  /dispatch); auditoría sin secretos; static-safety test. UI `Notification
  Center` bajo Automation Center (badge DRY RUN, sin botón Enviar), KPI
  `Notificaciones Pendientes`, sección en Client 360 y paso de preview en
  Automation. RBAC: lectura todos; escribir Super Admin/Administrador/Cobranza/
  Soporte. No envía nada real. ✅ Validada por Hermes en staging (commit
  `6911c25`). Ver `docs/NOTIFICATION_ENGINE_FOUNDATION_RESULT.md` y
  `docs/NOTIFICATION_ENGINE_FOUNDATION_STAGING_RESULT.md`.

> ✅ Aprobación staging (4.9.2 / 4.9.2.1): **APROBADA por Hermes** sobre el commit
> `a0c9b55`. Persistencia real Supabase con restart demostrada para `pcc_5wan` y
> `router_base_wireguard` (download post-restart = 200; `wireguardSnapshot` saneado).
> Evidencia formal en `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`. El veredicto
> NO APROBADA previo en `docs/DYNAMIC_TEMPLATE_PARAMETERS_STAGING_RESULT.md` quedó
> superado. No retomar salvo regresión nueva documentada.

### B. Regla de contradicciones

Si este checklist contradice un documento de aprobación más reciente en `docs/`,
**actualizar el checklist antes de avanzar**. El documento de aprobación con evidencia
manda sobre la memoria, el roadmap y este checklist.

### C. Prioridad inmediata (absoluta)

> **Reconciliación 2026-06-25 (post-PROD-9):** la pista de *foundations dry-run*
> avanzó hasta PROD-9. Estado de validación Hermes: PROD-7 ✅, ARCH-1 ✅, PROD-9 ✅;
> **PROD-8 Automation queda pendiente de Hermes** (sin `STAGING_RESULT`). Siguiente
> fase recomendada en esa pista = **PROD-10 Worker Engine Dry-Run** (propuesta
> gated; NO implementar sin autorización explícita de Ramiro; no activar
> `MIKROTIK_WORKER_LIVE`, sin RouterOS Write). La prioridad de la **pista RouterOS**
> sigue siendo PROD-4 (abajo), también gated. Ninguna se inicia sin aprobación.

**PROD-4 — CHR Real Read-Only Integration (abstracción de providers; PREPARADO,
NO CONECTADO).**

DB-1, Inventory 4.11.1, NOC 4.11.2, NOC Real Telemetry 4.11.3,
PROD-1 Manual Safe Mode, FAST-1 / PROD-2 Safe Command Queue Dry-Run y PROD-3
RouterOS Read-Only Lab ya fueron aprobadas por Hermes / están validadas. La
prioridad actual es validar PROD-4 manteniendo el comportamiento mock por defecto,
sin conectar RouterOS real ni activar workers.

Estado PROD-3 (base, sin cambios de contrato):

- Implementado localmente en `backend/domains/routeros-readonly/`.
- Endpoints GET-only `/api/routeros/identity`, `/api/routeros/system`,
  `/api/routeros/interfaces`, `/api/routeros/routes`, `/api/routeros/wireguard`.
- UI `src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx`.
- RBAC: SA/Admin/Técnico/Soporte/Solo lectura permitidos; Cobranza 403.
- Resultado local: `docs/ROUTEROS_READ_ONLY_LAB_RESULT.md`.

Estado PROD-4 / PROD-5 — CHR Real Read-Only (cliente real conectable, gated/solo lab):

- Abstracción de providers en `backend/domains/routeros-readonly/providers/`
  (interface async, `mock-provider`, `routeros-provider`, `fallback`, factory).
- Feature flag `ROUTEROS_READONLY_PROVIDER` (`mock` default | `routeros`).
- **PROD-5 (este sprint = conectar el CHR real read-only de PROD-4):** cliente
  REST real `providers/routeros-client.ts` configurado por entorno
  (`ROUTEROS_HOST/PORT/USERNAME/PASSWORD/TIMEOUT_MS/TLS_REJECT_UNAUTHORIZED`).
  Mapea cada `print` allowlisted a su ruta REST y hace `GET` HTTPS con Basic Auth
  y timeout. Sin credenciales → cliente no configurado → fallback a mock
  (API 200, `source=mock`). Logs `routeros_read_success`/`routeros_read_fallback`
  sin secretos. UI: indicador `Fuente: MOCK | ROUTEROS` (sin rediseño).
- Allowlist de comandos `print`; transporte read-only (solo `GET`). Sin
  `.add/.set/.remove/.execute`, sin escritura.
- ⚠️ Producción permanece en `mock`. La integración `routeros` es **solo CHR de
  lab**; NO apuntar a RB5009 ni routers reales. Pendiente validación Hermes.
- Endpoints/RBAC sin cambios de contrato.
- Tests `routeros.readonly.*` + `routeros.client` + `routeros.provider.integration`.
- Resultado local: `docs/PROD5_CHR_REAL_READ_ONLY_RESULT.md`
  (antecedente `docs/CHR_REAL_READ_ONLY_RESULT.md`).

Estado UX-1 (solo UI/UX de navegación + Manual de Usuario + Dashboard, completada):

- Sidebar final en 6 secciones WISP en español (Inicio, Clientes, Red, MikroTik,
  Reportes, Sistema) en `src/components/Sidebar.tsx`. NOC vive en Red; Routers
  (`inventory-routers`) en MikroTik; `RouterOS Lab` renombrado a `Laboratorio
  MikroTik` (etiqueta del menú). Panel MikroTik (`mikrotik`) se mantiene visible
  (no está en la lista de ocultos).
- WireGuard, Modo Seguro Manual y Cola Dry-Run **ocultos del sidebar** (decisión
  de producto): siguen accesibles por RBAC y tab/URL directo; código, rutas y
  tests intactos. Separación visibilidad/acceso vía `isVisibleInSidebar` y
  `SIDEBAR_HIDDEN_TABS` en `src/lib/rbac.ts`. RBAC funcional sin cambios.
- Módulo `user-manual` (`src/modules/user-manual/UserManualModule.tsx`, frontend,
  sin backend), visible para todos los roles incl. Cobranza; ahora con FAQ.
- Dashboard (`src/components/Dashboard.tsx`): bloque "Resumen operativo" priorizado
  (estado de red + alertas + KPIs enlazables) sobre datos existentes; sin tema nuevo.
- Backend/endpoints/providers/RouterOS y tema/colores sin tocar.
- Tests: `navigation.ui`, `rbac.frontend`, `manual-safe-mode.ui`,
  `safe-command-queue.ui`, `routeros.readonly.ui`, `user-manual.ui`, `dashboard.ui`.
- Resultado: `docs/UI_NAVIGATION_SIMPLIFICATION_RESULT.md`. No avanzar a PROD-5
  hasta validar esta UX con Hermes.

Estado CUSTOMER-IPAM-1 (alta de cliente WISP, local/mock):

- Dominio `backend/domains/ipam/` con repository mock y cálculo IPv4/CIDR local.
- Endpoints `/api/ipam/routers`, `/api/ipam/routers/:routerId/pools`,
  `/api/ipam/pools/:poolId/available-ips` y `/api/ipam/validate-ip`.
- Alta CRM con Router/Torre, Pool/Segmento, selector/manual de IP y estado.
- Cliente Activo requiere IP disponible; Lead Comercial puede quedar sin IP.
- `POST /api/clients` revalida cualquier asignación enviada y bloquea duplicados.
- Sin RouterOS, CHR, Worker Live, queues, address-list ni flags MikroTik.
- `assignedIp` usa `clients.ip_assigned`; metadatos `routerId`, `poolId` y
  `ipAssignmentStatus` solo persisten por ahora en el store local.
- Resultado: `docs/IP_ASSIGNMENT_CUSTOMER_ONBOARDING_RESULT.md`.

Estado WISP-CORE-1 (WISP-1 a WISP-5, implementado localmente):

- Capacidad informativa por router/torre en
  `GET /api/ipam/routers/:routerId/capacity`.
- GPS automático con `navigator.geolocation`, edición manual y validación de
  latitud/longitud.
- Cobertura mock/local en `GET /api/coverage/check` con distancia, azimut,
  porcentaje y `GOOD/WARNING/POOR`; no bloquea altas.
- Reserva de CPE/PoE/fuente en memoria con estado `RESERVED`; no descuenta stock.
- Técnico puede acceder a CRM y crear el alta WISP; los controles de ciclo de
  vida permanecen limitados a sus roles backend existentes.
- Providers IPAM async con `IPAM_PROVIDER=mock` default y provider `routeros`
  no configurado que cae a mock. Sin cliente, host, credenciales ni comandos.
- Dashboard con clientes por torre, capacidad, reservas e instalaciones pendientes.
- Manual actualizado con Alta de Cliente WISP y placeholders.
- `npm run typecheck`, `npm test` (1358 passed) y `npm run build`: PASS.
- Resultado: `docs/WISP_CORE_PRODUCTION_SPRINT_RESULT.md`.
- Pendiente: validación staging por Hermes. No avanzar a PROD-5, Worker Live
  ni RouterOS real.

### C.1 Hotfix paralelo activo (frontend)

**NugaCore — Hotfix Frontend Polling / Rate Limit Hygiene**

Estado actual:

- Implementado localmente en frontend.
- Validaciones locales completadas: `npm run typecheck`, `npm test`, `npm run build`.
- Pendiente: observación final en staging (frecuencia de 429 y comportamiento de cooldown).

**Hotfix Payments Auth Headers**

- `PaymentsModule` ya no autoafirma identidad con `x-user-role`/`x-user-id`.
- Todas sus llamadas usan el Bearer JWT mediante `getAuthHeaders`.
- Endpoints cubiertos: orders, actions, create order y reactivación.
- RBAC visual y `canWritePayments` sin cambios.
- Resultado: `docs/PAYMENTS_AUTH_HEADERS_HOTFIX_RESULT.md`.
- Pendiente Hermes: redeploy/smoke test de Pagos. La host key SSH debe ser
  verificada por el operador; no se modifica desde el repo.

Documentos fuente:

- `docs/FRONTEND_POLLING_RATE_LIMIT_AUDIT.md`
- `docs/FRONTEND_POLLING_RATE_LIMIT_RESULT.md`

### D. DB-1 — Reconciliación de `mikrotik_routers` (cerrada en staging)

**Diseño COMPLETO** en [`docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`](./MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md)
(estado actual, modelo canónico columna por columna, compatibilidad, impacto, estrategia
de migración y riesgos). **Hallazgo clave:** la migración `20260605000000` ya es evolutiva
(`ADD COLUMN IF NOT EXISTS`); el conflicto histórico fue corregido en `b4d19c4`/`7264e59`.
El modelo TS (`MikrotikRouterRegistryItem`, `ProvisionedRouterView`) ya está unificado.

Hecho (diseño, esta sesión):

- [x] Auditar las dos definiciones de `mikrotik_routers` (monitoreo vs provisioning) + modelos TS, stores y tests.
- [x] Crear `docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`.
- [x] Diseñar el modelo canónico combinado monitoring + provisioning.

Implementación (DB-1, completada — ver [`docs/MIKROTIK_SCHEMA_IMPLEMENTATION_RESULT.md`](./MIKROTIK_SCHEMA_IMPLEMENTATION_RESULT.md)):

- [x] Migración de sellado `20260618000000_mikrotik_routers_reconciliation.sql` (solo `ADD COLUMN`/`CREATE INDEX IF NOT EXISTS`; sin DROP/DELETE/UPDATE de datos).
- [x] No modificar ni aplicar directamente `20260605000000_mikrotik_provisioning_schema.sql` (no se tocó).
- [x] `USE_DB_MIKROTIK` NO activado (no existe repository DB de MikroTik aún).
- [x] Validador de schema `scripts/validate-mikrotik-schema.mjs` (opt-in `RUN_DB_TESTS`, sin secretos).
- [x] Tipos alineados al modelo canónico (`CANONICAL_MIKROTIK_ROUTER_COLUMNS`, `MikrotikRouterRegistryItem`).
- [x] Tests de estructura/idempotencia/consistencia (`tests/unit/mikrotik.schema-reconciliation.test.ts`, 12 tests).
- [x] `npm run typecheck`, `npm test` (1028 passed), `npm run build` → PASS.
- [x] Runbook para Hermes documentado.
- [x] Listo para validación staging, sin aplicar desde Claude.

Pendiente (NO en esta sesión):

- [x] Aplicación + validación staging por **Hermes** (runbook en el doc de resultado); registrar migraciones en `schema_migrations` + `NOTIFY pgrst`.
- [ ] (Opcional, futuro) Migración de backfill de espejos (`management_ip`/`provisioning_status`) con `UPDATE` guardado — fuera de DB-1.
- [ ] Repository DB de MikroTik para `USE_DB_MIKROTIK=true` (fase posterior).

Después de DB-1 (validado en staging): **Inventory Read-Only → NOC Read-Only** — diseño en
[`docs/NOC_READ_ONLY_ARCHITECTURE.md`](./NOC_READ_ONLY_ARCHITECTURE.md).

**4.11.1 Inventory Read-Only Foundation: aprobada en staging** — ver
[`docs/INVENTORY_READ_ONLY_STAGING_RESULT.md`](./INVENTORY_READ_ONLY_STAGING_RESULT.md).
Backend + UI **read-only** sobre `mikrotik_routers` (store en memoria), sin activar
`USE_DB_MIKROTIK`.

**4.11.2 NOC Read-Only Foundation: implementada localmente** (pendiente validación
Hermes en staging).

**4.11.3 NOC Real Telemetry (read-only): implementada localmente** (pendiente
validación Hermes en staging) — ver
[`docs/NOC_REAL_TELEMETRY_RESULT.md`](./NOC_REAL_TELEMETRY_RESULT.md).

Hecho (local, esta sesión; sin staging, sin producción, sin migraciones):

- [x] Dominio `backend/domains/noc-telemetry/` (`types.ts`, `mappers.ts`, `service.ts`, `routes.ts`).
- [x] Endpoints read-only `GET /api/noc/health` y `GET /api/noc/towers` (RBAC = 4.11.2; Cobranza 403).
- [x] `GET /api/noc/alerts` reutilizado del dominio `noc` (no se duplica la ruta).
- [x] `NocRouterView` enriquecido con `towerId?`/`towerName?` (aditivo, backward-compatible).
- [x] UI `src/components/NocTelemetryModule.tsx` integrada en el tab `noc` (badge READ-ONLY, widgets, tablas, alertas).
- [x] Tests: contract (16) + service unit (8) + ui unit (7).
- [x] `npm run typecheck`, `npm test`, `npm run build` → PASS.
- [x] Sin secretos; sin activar `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/commit mode.

Pendiente (NO en esta sesión):

- [ ] Validación funcional staging por **Hermes** (endpoints + RBAC + payload sin secretos + UI).

**PROD-1 Manual Safe Mode: implementada localmente** (pendiente validación Hermes en
staging) — ver [`docs/PROD1_MANUAL_SAFE_MODE_RESULT.md`](./PROD1_MANUAL_SAFE_MODE_RESULT.md).

Hecho (local, esta sesión; sin staging, sin producción, sin migraciones, sin ejecución real):

- [x] Dominio `backend/domains/manual-safe-mode/` (`types.ts`, `repository.ts`, `mappers.ts`, `service.ts`, `routes.ts`) sobre store en memoria.
- [x] Modelo `SafeAction` + auditoría `SafeActionAudit`; estados `PENDING/APPROVED/REJECTED/SIMULATED/CANCELLED` (**sin `EXECUTED`**); modos `MANUAL/DRY_RUN/FUTURE_AUTOMATION`.
- [x] Endpoints `GET/POST /api/manual-actions`, `GET /:id`, `POST /:id/{approve,reject,simulate,cancel}` (RBAC; Cobranza 403).
- [x] `simulateAction` solo `PENDING → SIMULATED` + auditoría; ningún endpoint ejecuta RouterOS/WireGuard/billing/suspensión/shell/workers.
- [x] UI `src/modules/manual-safe-mode/ManualSafeModeModule.tsx` (badge SAFE MODE).
- [x] Hotfix UI Navigation: cableado en `Sidebar` + `App` + RBAC frontend (`rbac.ts` tab `manual-safe-mode`, visible para 5 roles, Cobranza oculto). Sin ejecución real.
- [x] Tests: contract (18) + service (11) + ui (5).
- [x] `npm run typecheck`, `npm test`, `npm run build` → PASS.
- [x] Sin secretos; sin activar `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/commit mode; sin migraciones.

Pendiente PROD-1 (NO en esta sesión):

- [ ] Validación funcional staging por **Hermes** (ciclo de estados + RBAC + ausencia de ejecución real).

**FAST-1 Safe Command Queue (dry-run): implementada localmente** (pendiente validación
Hermes) — ver [`docs/SAFE_COMMAND_QUEUE_DRY_RUN_RESULT.md`](./SAFE_COMMAND_QUEUE_DRY_RUN_RESULT.md).

Hecho (local, esta sesión; sin staging, sin producción, sin migraciones, sin ejecución real):

- [x] Dominio `backend/domains/safe-command-queue/` (store en memoria) — estados `PENDING/VALIDATED/SIMULATED/APPROVED/REJECTED/CANCELLED`; **sin `EXECUTED`/`RUNNING`/`COMPLETED`**; `dryRun=true`, `wouldExecute=false`.
- [x] Endpoints `GET/POST /api/safe-command-queue` (+ `:id`, `:id/validate|simulate|approve|reject|cancel`); **sin `/execute`**; approve exige simular antes; RBAC con Cobranza 403.
- [x] Dry-run preview (`simulatedCommands` descriptivos), `riskLevel`, `safetyWarnings`; payload/campos libres saneados vía `sanitize-sensitive-data`.
- [x] UI `src/modules/safe-command-queue/SafeCommandQueueModule.tsx` (badge DRY RUN) cableada en Sidebar + App + RBAC frontend.
- [x] Tests: contract (16) + service (10) + ui (8) + rbac.frontend actualizado.
- [x] Docs de preparación: `docs/CHR_LAB_PREP_RUNBOOK.md` (Parte C) y `docs/ROUTEROS_READ_ONLY_API_PLAN.md` (Parte D), ambos documentales/gated.
- [x] `npm run typecheck`, `npm test`, `npm run build` → PASS.
- [x] Sin activar `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/commit mode/write enabled; sin tocar RouterOS ni routers reales.

Pendiente FAST-1 / siguiente (NO en esta sesión):

- [ ] Validación staging por **Hermes** (ciclo dry-run + RBAC + ausencia de ejecución).
- [ ] Fase siguiente (gated): RouterOS read-only en CHR de lab (`docs/ROUTEROS_READ_ONLY_API_PLAN.md`).

**PROD-3 RouterOS Read-Only Lab Foundation: implementada localmente** (pendiente
validación Hermes en staging) — ver
[`docs/ROUTEROS_READ_ONLY_LAB_RESULT.md`](./ROUTEROS_READ_ONLY_LAB_RESULT.md).

Hecho (local, esta sesión; sin staging, sin producción, sin migraciones, sin RouterOS real, sin conexión real, sin escritura):

- [x] Dominio `backend/domains/routeros-readonly/` (`types.ts`, `mock-provider.ts`, `mappers.ts`, `service.ts`, `routes.ts`) sobre provider **mock** en memoria.
- [x] Endpoints **solo GET** `/api/routeros/{identity,system,interfaces,routes,wireguard}`; sin POST/PUT/PATCH/DELETE.
- [x] RBAC: SA/Admin/Técnico/Soporte/Solo lectura; Cobranza 403. Payloads estables y sin secretos (sin claves privadas/preshared keys).
- [x] UI `src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx` (badge `READ ONLY LAB`, banner "Esta vista no ejecuta cambios ni comandos RouterOS."), cableada en `App` + `Sidebar` + `rbac.ts`. Sin botones de escritura ni `execute`.
- [x] Tests (`routeros.readonly.*`): contract + service/mappers + ui + **security** (falla si aparecen tokens de escritura RouterOS en el dominio y exige rutas solo-GET).
- [x] `npm run typecheck`, `npm test`, `npm run build` → PASS.
- [x] Sin activar `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/commit mode/write enabled.

Pendiente PROD-3 (NO en esta sesión):

- [ ] Validación funcional staging por **Hermes** (5 endpoints + RBAC + payload sin secretos + UI + ausencia de escritura).

**PROD-4 a PROD-7: TODO — NO implementar todavía** (gated). Ver `ROADMAP.md`
sección "PROD-3 a PROD-7":

- [ ] PROD-4 CHR Real Read-Only Integration (solo lectura sobre CHR de lab; allowlist de `print`; requiere aprobación Hermes).
- [ ] PROD-5 Safe Command Queue Dry-Run sobre CHR (simular contra datos del CHR; requiere PROD-4).
- [ ] PROD-6 Primer comando real controlado en CHR (acción mínima reversible; requiere PROD-5 + autorización Ramiro).
- [ ] PROD-7 Piloto en router no crítico (requiere PROD-6 + autorización Ramiro).

### E. Qué NO hacer

**No avanzar a Worker Live, Real Provisioning ni Commit Mode.** DB-1 e Inventory 4.11.1
ya están validadas en staging, pero NOC sigue en modo foundation read-only.
No activar `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE` ni commit mode.
No aplicar migraciones en Supabase ni tocar routers/datos reales desde esta tarea
automática.

## 1. Antes de tocar código

- [ ] Leer `ROADMAP.md`.
- [ ] Leer `docs/PRODUCTION_READINESS_CHECKLIST.md`.
- [ ] Leer `docs/ARCHITECTURE.md`.
- [ ] Leer el documento específico de la fase en `docs/` si existe.
- [ ] Ejecutar:

```bash
git status --short --branch
git log --oneline -8
```

- [ ] Confirmar que se está en la rama correcta.
- [ ] Confirmar si la tarea es:
  - [ ] análisis/documentación solamente,
  - [ ] desarrollo local,
  - [ ] migración DB,
  - [ ] deploy staging,
  - [ ] operación sobre infraestructura,
  - [ ] acción que podría tocar routers reales.

Si la tarea puede tocar infraestructura real, routers reales, datos reales o producción, detenerse y pedir autorización explícita.

## 2. Reglas de seguridad obligatorias

- [ ] No imprimir secretos.
- [ ] No commitear `.env` reales.
- [ ] No pegar tokens/JWT/service role en issues, docs o logs.
- [ ] No imprimir scripts RouterOS completos.
- [ ] No guardar scripts completos en DB.
- [ ] No activar `USE_DB_MIKROTIK` salvo instrucción explícita.
- [ ] No activar `MIKROTIK_WORKER_LIVE` salvo fase aprobada.
- [ ] No activar commit mode salvo rollback aprobado.
- [ ] No ejecutar RouterOS real desde staging.
- [ ] No borrar datos reales sin backup y autorización.

## 3. Flujo estándar de desarrollo

Para cada cambio:

1. Crear o identificar el issue/fase.
2. Leer archivos relacionados.
3. Escribir o actualizar tests primero cuando aplique.
4. Implementar cambio mínimo.
5. Ejecutar checks.
6. Documentar resultado.
7. Commit pequeño y claro.
8. Push sin amend ni force-push salvo instrucción explícita.

Comandos base:

```bash
npm run typecheck
npm test
npm run build
```

Si toca DB:

```bash
RUN_DB_TESTS=true npm run test:db
```

Si toca Router Enrollment:

```bash
RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs
RUN_DB_TESTS=true USE_DB_ROUTER_ENROLLMENT=true npm run test:db
```

Si toca migraciones staging:

```bash
RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs
```

## 4. Convención de commits

Usar Conventional Commits:

- `feat(scope): ...`
- `fix(scope): ...`
- `docs(scope): ...`
- `test(scope): ...`
- `chore(scope): ...`

Ejemplos:

```bash
git commit -m "fix(router-enrollment): persist wireguard snapshot for post-restart downloads"
git commit -m "docs(roadmap): add production readiness checklist"
git commit -m "test(router-enrollment): cover download after real restart prerequisites"
```

No usar:

- `git commit --amend` sin autorización.
- `git push --force` sin autorización.
- commits mezclando código, migraciones y docs no relacionadas.

## 5. Criterio para marcar una fase como APROBADA

Una fase solo se marca APROBADA si tiene:

- [ ] Código implementado.
- [ ] Migraciones aplicadas si corresponde.
- [ ] Typecheck PASS.
- [ ] Tests PASS.
- [ ] Build PASS.
- [ ] Tests DB PASS si corresponde.
- [ ] Validación funcional real en staging.
- [ ] Restart/deploy real probado si la fase involucra persistencia.
- [ ] Seguridad/log hygiene verificada.
- [ ] Cleanup de artefactos test.
- [ ] Documento de aprobación en `docs/`.
- [ ] Commit documental si la fase lo pide.

Si una sola de estas falla, reportar `NO APROBADA` y especificar:

- endpoint,
- tabla/columna,
- error,
- si ocurrió antes o después de restart,
- acción recomendada.

## 6. Flujo para migraciones Supabase

Antes de aplicar:

- [ ] Confirmar repo actualizado.
- [ ] Confirmar commit esperado en `git log`.
- [ ] Leer migración completa.
- [ ] Verificar que no hay `DROP` destructivo no autorizado.
- [ ] Verificar patrón evolutivo en tablas existentes:
  - [ ] `CREATE TABLE IF NOT EXISTS` mínimo si aplica.
  - [ ] `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
  - [ ] índices después de garantizar columnas.
  - [ ] backfill guardado con checks.

Aplicar:

```bash
supabase db query --linked --file supabase/migrations/<archivo>.sql
supabase db query --linked "NOTIFY pgrst, 'reload schema';"
```

Después:

- [ ] Ejecutar validator específico.
- [ ] Ejecutar `RUN_DB_TESTS=true npm run test:db` si aplica.
- [ ] Revisar integridad con conteos, no dumps sensibles.
- [ ] Documentar resultado.

## 7. Flujo para deploy Coolify staging

- [ ] Confirmar commit esperado en repo local.
- [ ] Confirmar flags runtime por nombre, no valores secretos.
- [ ] Trigger deploy desde Coolify/API.
- [ ] Esperar imagen/contenedor con commit esperado.
- [ ] Verificar contenedor healthy.
- [ ] Verificar healthchecks:

```bash
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health/live
curl -fsS https://nugacore-staging.5.180.151.109.sslip.io/api/health/ready
```

- [ ] Validar endpoint/flujo de la fase.
- [ ] Escanear logs por patrones sensibles sin imprimir líneas completas.

## 8. Checklist específico: Fase 4.9.2 Dynamic Parameters

> ✅ **Fase 4.9.2 APROBADA** por Hermes sobre `a0c9b55` (ver
> `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`). No retomar salvo regresión nueva.
> La prioridad actual es DB-1 (§0.C). El checklist de abajo queda como histórico de cierre.

Contexto (cerrado):

- `router_snapshot` y `wireguard_snapshot` agregados (commits `bf438ed`, `a0c9b55`).
- Migraciones de `router_enrollment` + snapshots aplicadas/registradas en staging + `NOTIFY pgrst` (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
- Validación de Hermes: restart + download = 200 para `pcc_5wan` y `router_base_wireguard`.

Checklist histórico de cierre (cumplido):

- [ ] Implementar `wireguard_snapshot` no sensible o activar/validar `USE_DB_WIREGUARD=true`.
- [ ] Aplicar migración correspondiente.
- [ ] Validar schema.
- [ ] Redeploy commit nuevo.
- [ ] Confirmar `USE_DB_ROUTER_ENROLLMENT=true`.
- [ ] Mantener `USE_DB_MIKROTIK` apagado.
- [ ] Mantener `MIKROTIK_WORKER_LIVE=false`.
- [ ] Crear enrollment con `pcc_5wan` y parámetros dinámicos.
- [ ] GET detail antes del restart = 200.
- [ ] Reiniciar contenedor.
- [ ] GET detail post-restart = 200.
- [ ] GET download post-restart = 200.
- [ ] Confirmar script descargado contiene marcadores esperados sin imprimirlo completo:
  - [ ] `10.77.0.1`
  - [ ] `sfp1`
  - [ ] `200.1.1.1`
- [ ] Confirmar logs sin secretos/scripts completos.
- [ ] Limpiar artefactos test.
- [ ] Crear `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`.
- [ ] Commit/push documental.

## 9. Checklist específico: WireGuard persistence/snapshot

Si se implementa `USE_DB_WIREGUARD=true`:

- [ ] Migración de `wireguard_servers` validada.
- [ ] Migración de `wireguard_peers` validada.
- [ ] Migración de IP allocations validada.
- [ ] Default server persiste.
- [ ] Peer persiste.
- [ ] IPAM no duplica IPs.
- [ ] Revoke libera IP correctamente.
- [ ] Rotate keys no expone secretos.
- [ ] Restart real conserva capacidad de download.

Si se implementa `wireguard_snapshot`:

- [ ] Snapshot no contiene private key.
- [ ] Snapshot no contiene preshared key.
- [ ] Snapshot no contiene passwords.
- [ ] Snapshot no contiene script completo.
- [ ] Snapshot contiene solo lo mínimo para regenerar download autorizado.
- [ ] Caso legacy sin snapshot devuelve error controlado.

## 10. Checklist específico: MikroTik real

No iniciar hasta aprobar modo manual/read-only.

Prerrequisito de datos (bloqueante):

- [ ] Reconciliar `mikrotik_routers` schema antes de activar `USE_DB_MIKROTIK` (drift monitoreo vs provisioning; ver `docs/SUPABASE_MIGRATIONS_SYNC.md`). La migración `20260605000000_mikrotik_provisioning_schema.sql` NO debe aplicarse tal cual; requiere una migración evolutiva nueva (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

Antes de RouterOS real:

- [ ] CHR/lab configurado.
- [ ] Backup/export antes de cambios.
- [ ] API RouterOS probada read-only.
- [ ] Credenciales cifradas.
- [ ] Worker separado.
- [ ] Dry-run probado.
- [ ] Cola de comandos probada.
- [ ] Auditoría persistida.
- [ ] Rollback documentado.
- [ ] Acción piloto definida.
- [ ] Router no crítico seleccionado.
- [ ] Autorización explícita del operador.

Prohibido:

- [ ] No ejecutar comandos masivos sin fase aprobada.
- [ ] No cambiar firewall/routing sin rollback.
- [ ] No suspender clientes reales automáticamente sin piloto.
- [ ] No exponer RouterOS API públicamente.

## 11. Checklist para documentación nueva

Toda documentación nueva debe:

- [ ] Ser entendible para alguien sin contexto de la conversación.
- [ ] Decir qué existe hoy.
- [ ] Decir qué falta.
- [ ] Decir qué está bloqueado.
- [ ] Incluir comandos de verificación.
- [ ] No incluir secretos.
- [ ] No incluir IDs internos innecesarios de infraestructura.
- [ ] Diferenciar staging vs producción.
- [ ] Diferenciar funcional vs production-ready.

## 12. Reporte final esperado por tarea

Formato recomendado:

```text
Resultado: APROBADA / NO APROBADA / PARCIAL

Hecho:
- ...

Validado con:
- comando / endpoint / resultado

Bloqueadores:
- endpoint / tabla / columna / error

Seguridad:
- flags críticos
- logs sin secretos

Cleanup:
- artefactos removidos

Siguiente paso:
- acción concreta
```

## 13. Prioridad inmediata del proyecto

Prioridad absoluta para la tarea automática (ver §0.C y §0.D). El orden es estricto;
no avanzar a un punto sin cerrar el anterior:

1. **DB-1 — Reconciliar el schema de `mikrotik_routers`** antes de activar `USE_DB_MIKROTIK`.
2. Inventory Read-Only (**4.11.1 foundation implementada localmente**; pendiente validación Hermes).
3. NOC Read-Only (**4.11.2 foundation + 4.11.3 real telemetry implementadas localmente**; pendiente validación Hermes).
4. PROD-1 Manual Safe Mode.
5. Safe Command Queue dry-run.

4.9.2 / 4.9.2.1: ✅ **APROBADA** por Hermes sobre `a0c9b55` (ver
`docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`). No retomar salvo regresión nueva.

No avanzar a 4.9.3 Real Provisioning, Worker live ni commit mode hasta cerrar DB-1 y
el modo manual seguro.
