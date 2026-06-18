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

> ⚠️ Matiz de aprobación staging (4.9.2 / 4.9.2.1): el código está en `main`, pero el
> último documento de validación staging,
> `docs/DYNAMIC_TEMPLATE_PARAMETERS_STAGING_RESULT.md`, quedó **NO APROBADA** porque
> `public.router_enrollment` no estaba expuesta en PostgREST. Ese bloqueador fue
> reconciliado a nivel DB el 2026-06-18 (migraciones de `router_enrollment` + snapshots
> aplicadas/registradas y `NOTIFY pgrst`; ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
> **Falta la revalidación funcional de Hermes (restart + download)** para emitir
> `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`. No marcar 4.9.2 como APROBADA hasta
> que ese documento exista con evidencia.

### B. Regla de contradicciones

Si este checklist contradice un documento de aprobación más reciente en `docs/`,
**actualizar el checklist antes de avanzar**. El documento de aprobación con evidencia
manda sobre la memoria, el roadmap y este checklist.

### C. Prioridad inmediata (absoluta)

**DB-1 — Reconciliar el schema de `mikrotik_routers` antes de activar `USE_DB_MIKROTIK`.**

Es la única tarea de mayor prioridad accionable y segura. Trabajo local: análisis,
diseño de modelo canónico, migración evolutiva nueva y validadores. **No** aplica
migraciones en Supabase ni activa flags.

### D. DB-1 — Reconciliación de `mikrotik_routers`

Pendientes:

- [ ] Auditar las dos definiciones actuales de `mikrotik_routers`:
  - init_schema (modelo de monitoreo).
  - mikrotik_provisioning_schema (modelo de provisioning).
- [ ] Crear documento `docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`.
- [ ] Diseñar modelo canónico combinado monitoring + provisioning.
- [ ] Crear nueva migración evolutiva con timestamp posterior.
- [ ] La migración debe usar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- [ ] No modificar ni aplicar directamente `20260605000000_mikrotik_provisioning_schema.sql`.
- [ ] No activar `USE_DB_MIKROTIK`.
- [ ] Actualizar `scripts/validate-staging-migrations.mjs`.
- [ ] Agregar tests unitarios de la migración.
- [ ] Validar que `npm run typecheck`, `npm test`, `npm run build` pasen.
- [ ] Documentar runbook para Hermes.
- [ ] Dejar listo para validación staging, pero sin aplicar manualmente desde Claude.

### E. Qué NO hacer

**No avanzar a NOC Read-Only, Inventory Read-Only, Real Provisioning, Worker Live ni
Commit Mode hasta cerrar DB-1.** No activar `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`,
`MIKROTIK_WORKER_LIVE` ni commit mode. No aplicar migraciones en Supabase ni tocar
routers/datos reales desde esta tarea automática.

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

> No es la prioridad actual (ver §0.C: la prioridad es DB-1). Las piezas de código
> están mergeadas en `main`; el cierre formal depende de la revalidación de Hermes
> (ver el matiz de aprobación en §0.A).

Contexto actual:

- `router_snapshot` y `wireguard_snapshot` ya fueron agregados (commits `bf438ed`, `a0c9b55`).
- Las migraciones de `router_enrollment` + snapshots están aplicadas/registradas en staging y se hizo `NOTIFY pgrst` (2026-06-18; ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
- Bloqueo restante: revalidación funcional de Hermes (restart + download) y emisión de `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`.

Para cerrar 4.9.2 (cuando Hermes lo retome) falta:

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
2. NOC Read-Only.
3. MikroTik Inventory Read-Only.
4. PROD-1 Manual Safe Mode.
5. Safe Command Queue dry-run.

Pendiente de **Hermes** (no de la tarea automática): revalidar 4.9.2 / 4.9.2.1 en
staging tras la reconciliación de migraciones del 2026-06-18 y emitir
`docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md` (ver §0.A).

No avanzar a 4.9.3 Real Provisioning, Worker live ni commit mode hasta cerrar DB-1 y
el modo manual seguro.
