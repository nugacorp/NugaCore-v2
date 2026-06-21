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
- HTTP Security (helmet + CORS allowlist + rate-limit).
- Observability básica (correlation ID, métricas in-memory, access log).

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

Estado PROD-4 (implementado localmente, pendiente Hermes):

- Abstracción de providers en `backend/domains/routeros-readonly/providers/`
  (interface async, `mock-provider`, `routeros-provider`, `fallback`, factory).
- Feature flag `ROUTEROS_READONLY_PROVIDER` (`mock` default | `routeros`).
- Provider `routeros` PREPARADO pero **sin cliente real** (no configurado): cae a
  mock por fallback (timeout/auth/host inalcanzable) → API 200, `source=mock`,
  warning sin secretos.
- Allowlist de comandos `print`; transporte read-only (`print` únicamente).
- Endpoints/UI/RBAC sin cambios. Sin `.add/.set/.remove/.execute`, sin escritura.
- Tests `routeros.readonly.*` (contract/service/ui/providers/security).
- Resultado local: `docs/CHR_REAL_READ_ONLY_RESULT.md`.

Estado UX-1 (solo UI/UX de navegación, completada):

- Sidebar reorganizado a 7 secciones WISP en español (Inicio, Clientes, Red WISP,
  MikroTik, Operaciones Seguras, Reportes, Sistema) en `src/components/Sidebar.tsx`.
- 21 IDs de tab conservados; `activeTab` y RBAC (`src/lib/rbac.ts`) sin cambios;
  backend/endpoints/providers/RouterOS sin tocar. Badges dentro de cada módulo.
- Contrato de navegación en `tests/unit/navigation.ui.test.ts`.
- Resultado: `docs/UI_NAVIGATION_REORGANIZATION_RESULT.md`. No avanzar a PROD-5
  hasta validar esta UX con Hermes.

### C.1 Hotfix paralelo activo (frontend)

**NugaCore — Hotfix Frontend Polling / Rate Limit Hygiene**

Estado actual:

- Implementado localmente en frontend.
- Validaciones locales completadas: `npm run typecheck`, `npm test`, `npm run build`.
- Pendiente: observación final en staging (frecuencia de 429 y comportamiento de cooldown).

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
