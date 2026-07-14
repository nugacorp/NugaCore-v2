# NugaCore — Plan de ejecución para llegar a Producción Real

**Fecha:** 2026-07-08  
**Autor:** Cloud Agent (Codex)  
**Objetivo:** llevar NugaCore desde estado actual (staging avanzado) a operación productiva real WISP/ISP.

---

## Contexto operativo importante

- Este entorno de agente **no tiene acceso SSH operativo al VPS** (sin host/llave/túnel cargado aquí).
- El flujo correcto del proyecto para VPS está documentado en:
  - `docs/HERMES_COOLIFY_STAGING_RUNBOOK.md`
  - `scripts/vps/preflight.sh`
  - `scripts/vps/validate-staging.sh`
- Por eso, este plan está diseñado para ejecución coordinada:
  - **Agente de código**: cambios de repo, tests, docs, scripts.
  - **Hermes/VPS operator**: deploy/redeploy/rollback/validación real en infraestructura.

---

## Meta de salida (Definition of Done para producción real)

Se considera alcanzado cuando:

1. Persistencia crítica cerrada + restore real con evidencia.
2. Seguridad de producción cerrada (`AUTH_TRUST_HEADERS=false`, JWT/RBAC probado).
3. Flujo de dinero real (webhooks/idempotencia/conciliación; CFDI según alcance).
4. Red real habilitada en modo gradual, auditado y reversible.
5. Operación de plataforma formal (pipeline/deploy/rollback/monitoreo).

---

## Fase A — Cierre de Staging Productivo (bloqueante)

### A.1 Persistencia y restore
- [ ] Aplicar migraciones en staging.
- [ ] Activar flags críticos `USE_DB_*` según `docs/STAGING_FLAGS_WISP_OS.md`.
- [ ] Verificar:
  - [ ] `GET /api/system/persistence-status` => `storeFallbackActive=false`
  - [ ] `GET /api/system/staging-readiness` => `ola0PersistenceClosed=true`
- [ ] Ejecutar:
  - [ ] `node scripts/validate-staging-readiness.mjs`
  - [ ] `RUN_DB_TESTS=true node scripts/validate-wisp-os-staging.mjs`
  - [ ] `node scripts/validate-restore-checklist.mjs`
- [ ] Ejecutar backup+restore real y dejar evidencia.

### A.2 Deploy/redeploy verificado en VPS
- [ ] `bash scripts/vps/preflight.sh` -> OK
- [ ] Deploy/redeploy en Coolify sobre commit objetivo
- [ ] `APP_URL=... bash scripts/vps/validate-staging.sh` -> PASS
- [ ] Rollback probado desde Coolify Deployments

**Salida Fase A:** staging confiable para operar sin pérdida de estado.

---

## Fase B — Seguridad de Producción

- [ ] Producción con `AUTH_TRUST_HEADERS=false`
- [ ] JWT obligatorio en endpoints sensibles
- [ ] Matriz de roles allow/deny validada con usuarios reales
- [ ] CORS allowlist, rate-limit, security headers, HTTPS/HSTS verificados
- [ ] Revisión de logs: sin secretos/tokens/JWT

**Salida Fase B:** superficie de seguridad de producción aprobada.

---

## Fase C — Dinero real (Billing/Payments/Fiscal)

- [ ] Facturas huérfanas = 0
- [ ] Pagos huérfanos = 0
- [ ] Idempotencia de webhooks probada
- [ ] Conciliación operativa validada
- [ ] Reactivación causal validada (no reactivar sin pago válido)
- [ ] CFDI/PAC (si entra al release) validado en ambiente seguro

**Salida Fase C:** operación financiera real confiable.

---

## Fase D — Red real gradual (sin saltar gates)

Orden obligatorio: **Ver -> Auditar -> Simular -> Confirmar -> Ejecutar -> Automatizar**

- [ ] NOC con telemetría real (fuente externa validada)
- [ ] Worker dry-run completo con auditoría
- [ ] Live controlado por lotes pequeños + rollback probado
- [ ] Prohibido activar global live sin evidencia por lote

**Salida Fase D:** operación de red real con control de riesgo.

---

## Fase E — Portal cliente y PWA técnicos (nivel productivo)

- [ ] Portal migra de token staging a auth cliente real (JWT/Supabase)
- [ ] PWA offline robusta (reintentos, deduplicación, conflictos)
- [ ] Validación en campo con técnicos y casos de reconexión

**Salida Fase E:** experiencia de cliente/campo lista para operación diaria.

---

## Fase F — Operación continua de plataforma

- [ ] Pipeline CI/CD formal con gates
- [ ] Estrategia de migraciones y rollback documentada y ensayada
- [ ] Monitoreo y alertado de API/jobs/workers activos
- [ ] Runbooks de incidentes y recuperación listos

**Salida Fase F:** plataforma operable por equipo, no por persona.

---

## Plan inmediato (lo que se trabaja desde hoy)

### Sprint técnico 1 (arranque real)
1. Cerrar Fase A completa (persistencia+restore+deploy+rollback evidence).
2. Cerrar Fase B (hardening auth/security).

### Sprint técnico 2
3. Cerrar Fase C (dinero real).
4. Arrancar Fase D en dry-run controlado (sin live global).

### Sprint técnico 3
5. Cerrar Fase D live gradual.
6. Cerrar Fase E (portal/PWA productivos).
7. Cerrar Fase F (operación continua).

---

## Registro de avance (desde hoy)

- 2026-07-08: Plan creado y versionado.
- 2026-07-08: Bloqueador identificado: sin acceso SSH directo desde este entorno; ejecución VPS delegada a Hermes/operator con runbook.
- 2026-07-08: Siguiente acción requerida del operador: correr `scripts/vps/preflight.sh` y `validate-staging.sh` sobre el último commit de la rama activa.
- 2026-07-09: Infraestructura de producción en repo: `GET /api/system/production-readiness`, Prometheus `/api/metrics/prometheus`, health/ready con ping Supabase, scripts `validate-production-readiness.mjs` / `smoke-production.sh`, workflow `production-gates.yml`, runbooks (backup, promoción, incidentes, rotación de secretos).

