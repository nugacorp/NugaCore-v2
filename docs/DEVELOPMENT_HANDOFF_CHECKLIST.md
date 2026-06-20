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

**4.11.2 — NOC Read-Only Foundation (validación staging por Hermes).**

DB-1 ya fue validada en staging por Hermes (`docs/MIKROTIK_SCHEMA_RECONCILIATION_STAGING_RESULT.md`) e
Inventory Read-Only 4.11.1 ya fue aprobado en staging (`docs/INVENTORY_READ_ONLY_STAGING_RESULT.md`).
La implementación local ya está completada; la prioridad actual es validar en staging
sin activar flags peligrosos.

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
