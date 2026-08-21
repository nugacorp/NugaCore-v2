# NugaCore — Estado actual

> **Actualizado: 2026-08-21.**
> Base: `main` después de fusionar el PR #108.
> Documento sanitizado: no contiene credenciales, tokens ni identificadores privados de operación.

Este documento es la fuente de verdad del estado del proyecto. Todo lo que afirma está clasificado con una de estas cuatro etiquetas, y ninguna afirmación cruza de categoría sin evidencia:

| Etiqueta | Significado |
| --- | --- |
| `VERIFICADO EN CÓDIGO/CI` | Comprobado en este repositorio por lectura de código y por pruebas que pasan en CI. |
| `NO CONFIRMADO EN STAGING` | El código existe, pero nadie ha comprobado el estado real de la base de datos de staging. |
| `REQUIERE AMBIENTE EXTERNO` | Depende de infraestructura que no está en el repositorio (proveedor de pagos, CHR, backups). |
| `REQUIERE AUTORIZACIÓN` | Es una decisión operativa humana, no una tarea de desarrollo. |

## Veredicto

NugaCore es una plataforma SaaS multi-tenant de operación para WISP/ISP, funcionalmente amplia y con una disciplina de pruebas alta. **No está aprobada para producción**, y el motivo ya no es el que decía este documento en julio: las brechas que quedan son de *validación externa*, no de código faltante.

Dicho de otro modo: casi todo está implementado; casi nada está probado contra el mundo real.

## Cerrado recientemente

### B1 — Reactivación automática por pago (Spec 001)

`VERIFICADO EN CÓDIGO/CI`

Era el blocker crítico: el resultado `eligible` era **inalcanzable por el ciclo real**. El único productor de `customer_suspension_blocks` era la suspensión manual, que siempre escribe `non_financial`; el motor de morosidad no creaba ningún bloqueo, así que `classifyActiveSuspension` clasificaba a todo suspendido como `unknown` y la reactivación fallaba cerrada siempre. Las pruebas pasaban porque sembraban el bloqueo a mano.

Cerrado en el PR #108:

- El motor emite un bloqueo `financial` al cortar por `DELINQUENT`, con evidencia `(suspension_order, order.id)` e idempotencia por el índice único `(tenant_id, evidence_type, evidence_id)`.
- **Invariante previo a RouterOS**: una orden de corte del motor no puede enviar comandos, marcar `effectStartedAt` ni llegar a `EXECUTED` sin su bloqueo activo persistido. Si la deuda dejó de ser bloqueante, la orden se cancela como no-op seguro.
- Reconciliación de fallo parcial en dos niveles: orden abierta (antes del efecto) y orden cerrada (sólo con ejecución RouterOS **realmente confirmada**: `EXECUTED` + `dryRun === false` + `executedAt` + `effectStartedAt` + `effectConfirmedAt`, y asociación inequívoca).
- Worker y lecturas acotados por tenant; eventos del motor sellados con `tenant_id`.
- Prueba de integración que recorre el ciclo por `PaymentService.processWebhook` sin sembrado artificial, y verifica que la reentrega del mismo evento no duplica nada.

`REQUIERE AMBIENTE EXTERNO`: el ciclo nunca se ha ejecutado contra un proveedor de pagos real ni contra un router real.

### Colisiones históricas de versión de migración

`VERIFICADO EN CÓDIGO/CI` — **resueltas**.

Dos pares de archivos compartían timestamp. Como el historial de Supabase registra una fila por versión, en cada par una migración quedó sin ejecutar y sin posibilidad de ejecutarse:

| Versión | Archivos | Consecuencia real |
| --- | --- | --- |
| `20260717040000` | `mikrotik_router_tenant` + `onboarding_status_fail_closed` | Sin daño: `mikrotik_routers.tenant_id` lo reaplicó `20260718175423`. |
| `20260717050000` | `multi_tenant_complete_ssot` + `olt_devices` | **El SSOT nunca se aplicó**: 39 de 42 tablas sin `tenant_id`; `/api/commercial/*` y `/api/payments/*` respondían 500 en staging. Se detectó 22 días después. |

Estado hoy:

- Datos reparados por `20260730120000_multi_tenant_complete_ssot_reapply` (`DOCUMENTADO`, ver `SUPABASE_MIGRATIONS_SYNC.md`).
- Archivos normalizados a `20260717040001` y `20260717050001` (PR #107).
- Puentes de historial añadidos para las versiones observadas en staging (PR #106).
- `KNOWN_DUPLICATE_VERSIONS` vacío en `scripts/report-migration-drift.mjs`.
- **76 migraciones, 76 versiones únicas, cero duplicados** — comprobado por `npm run validate:migration-files`.

### Guarda de nombres de migración

`VERIFICADO EN CÓDIGO/CI`

`scripts/validate-migration-files.mjs` (`npm run validate:migration-files`) es hermético: sólo lee nombres de archivo, no toca variables de base de datos ni Supabase. Rechaza versiones duplicadas, prefijos que no tengan 14 dígitos, descripciones ausentes, mayúsculas, espacios, guiones y una lista vacía de migraciones.

Corre en `ci.yml` y en `production-gates.yml` **antes** de lint, pruebas y build, así que una colisión falla rápido y de forma visible. Era la P1 abierta desde julio.

### Fixture PostgreSQL 17 de `customer_suspension_blocks`

`VERIFICADO EN CÓDIGO/CI`

Nuevo job `Customer suspension blocks · PostgreSQL 17 real` en `production-gates.yml`. Valida contra PostgreSQL real lo que el modo mock no puede afirmar: RLS, ACL mínima (`service_role` **sin** DELETE), índices, unicidad por evidencia, ciclo de creación y limpieza, y aislamiento por tenant.

Antes existía el fixture pero **ningún workflow lo ejecutaba**; `schema-replay` aplica las migraciones pero no corre estos asserts.

### Nombre del secreto de Mercado Pago

`VERIFICADO EN CÓDIGO/CI`

El backend compone el nombre del secreto a partir del proveedor interno, que es `mercado_pago`, así que la única variable válida es `WEBHOOK_SECRET_MERCADO_PAGO`. El checklist de Coolify documentaba el nombre sin guion bajo: nadie lo habría leído y, en runtime endurecido, el webhook responde 503 y los cobros se rompen en silencio.

Corregido, y protegido por un gate que rechaza el nombre incorrecto usado como asignación en `.env.example`, `.env.production.example`, `docs/deployment/`, `docs/runbooks/` y `docs/operations/`. Mencionarlo en prosa para advertir que no debe usarse sigue permitido.

La ruta HTTP `/api/payments/webhook/mercadopago` va sin guion bajo y es correcta: es una ruta, no una variable.

## Estado por área

`VERIFICADO EN CÓDIGO/CI` salvo donde se indique.

| Área | Estado |
| --- | --- |
| Multi-tenancy | Resolución de tenant fail-closed, aislamiento por repositorio, RLS en migraciones. Cobertura de pruebas amplia. |
| CRM / Clientes | Repositorio Supabase, timeline, documentos, borrado transaccional con fixture PG17. |
| Planes y facturación | Billing es la fuente canónica del dinero; rechaza sobrepagos y facturas saldadas. |
| Pagos | 5 proveedores (manual, Mercado Pago, OpenPay, SPEI, CoDi), HMAC, claim tenant-scoped, idempotencia durable. Sin sandbox real. |
| Suspensión / reactivación | Motor + bloqueos estructurados + saga durable + invariante previo a RouterOS. |
| MikroTik / RouterOS | Lectura con allowlist estricta; escritura acotada a 3 familias de comandos tras doble gate. Sin validación contra hardware. |
| WireGuard, OLT/FTTH, GIS, NOC/SNMP | Implementados; pollers apagados por defecto. |
| Inventario, tickets, contratos, portal, PWA técnicos, reportes | Implementados con repositorio Supabase (contratos con fixture PG17 propio). |
| Automatizaciones, notificaciones, CRM comercial, cobranza, client-360 | **Parciales**: usan store en memoria pese a tener tablas creadas. Ver blockers. |
| UISP / Splynx | No iniciado. Sólo mencionado en documentos de planificación. |

## Blockers actuales priorizados

### 1. Sandbox real de proveedor de pagos

`REQUIERE AMBIENTE EXTERNO` · Severidad alta · Spec 001 **T069**

Toda la cobertura de pagos es hermética. No existe evidencia de un webhook firmado aprobado, de una reentrega duplicada ni de un cobro real en sandbox. Runbook listo: `docs/runbooks/PAYMENT_SANDBOX_VALIDATION_WORKFLOW.md`.

### 2. Validación de escritura en laboratorio CHR

`REQUIERE AMBIENTE EXTERNO` · Severidad alta · Spec 001 **T070**

La lectura RouterOS se validó contra un CHR de laboratorio, pero esa evidencia es **histórica** (`docs/results/MIKROTIK_WORKER_LIVE_CHR_STAGING_RESULT.md`, 2026-06-05, sobre un commit anterior) y cubre sólo modo read-only. La **escritura nunca se ha ejecutado contra hardware**. Runbook listo: `docs/runbooks/CHR_MIKROTIK_LAB_READINESS_WORKFLOW.md`.

### 3. Paridad del esquema en staging

`NO CONFIRMADO EN STAGING` · Severidad alta · Spec 001 **T071**

`SUPABASE_MIGRATIONS_SYNC.md` está fechado el 2026-07-30 y refleja 52 archivos; hoy el repositorio tiene 76. **No se ha consultado la base de staging**, así que este documento no afirma que `20260814050000_customer_suspension_blocks` esté aplicada allí, ni que el backfill de `tenant_id` siga completo.

Criterio de cierre: `npm run report-migration-drift` contra staging sin pendientes, más verificación columna por columna (no por `schema_migrations`, que fue precisamente lo que ocultó el drift anterior).

### 4. Dominios críticos en memoria

`REQUIERE AUTORIZACIÓN` + código · Severidad alta para producción

El gate de readiness exige siete dominios en base de datos (`customers`, `plans`, `billing`, `support`, `inventory`, `suspension`, `payments`). Activarlos y verificar el comportamiento es trabajo de infraestructura y decisión operativa.

Aparte, `automation`, `notifications`, `commercial`, `collections`, `client-360`, `provisioning` y `service-status` siguen en store en memoria **pese a tener tablas creadas en migraciones**. Hay que decidir cuáles entran en el alcance de producción y cuáles tienen tablas huérfanas que retirar.

### 5. Evidencia de backup/restore

`REQUIERE AMBIENTE EXTERNO` + `REQUIERE AUTORIZACIÓN` · Severidad alta · Spec 001 **T073**

Existen tabla `backup_policy`, scripts de validación y runbooks. **No hay ningún restore ejecutado y verificado.** Sin eso no hay operación responsable con datos reales de clientes.

### 6. Readiness estricto de producción

`REQUIERE AMBIENTE EXTERNO` · Spec 001 **T072**

`npm run validate-production-readiness:strict` nunca se ha ejecutado contra una configuración de producción real.

### 7. Job `suspension-cycle` fail-closed

Corregible en código · Severidad media

El job no hereda tenant de ninguna petición y antes evaluaba todos los WISPs como uno solo. Ahora exige `SUSPENSION_CYCLE_TENANT_ID` y falla cerrado si falta. Queda pendiente una fuente autoritativa de tenants para recorrerlos uno a uno. Sólo corre con gates live encendidos, que están apagados.

### 8. Activación de gates live

`REQUIERE AUTORIZACIÓN`

`MIKROTIK_WORKER_LIVE`, `MIKROTIK_WORKER_COMMIT`, `PAYMENTS_ROUTER_LIVE` y el resto están apagados por defecto. Encenderlos es acción del operador en Coolify, gradual y con validación entre pasos. **No es una tarea de desarrollo.**

### 9. Decisión de producto sobre UISP

`REQUIERE AUTORIZACIÓN`

Aparece en documentos de planificación como integración futura; no hay código. Decidir si entra al roadmap o se retira de la documentación.

## Lo que este documento NO afirma

Explícitamente, y por falta de evidencia:

- **No** afirma que `20260814050000_customer_suspension_blocks` esté aplicada en staging.
- **No** afirma que ningún proveedor de pagos esté validado en sandbox.
- **No** afirma que la escritura RouterOS esté validada contra hardware.
- **No** afirma que exista un restore probado.
- **No** afirma que el readiness estricto esté aprobado.
- **No** afirma que ningún gate live esté activo.
- **No** declara un porcentaje de avance.

## Resultados actuales

Ejecutados localmente sobre la rama de esta fase, en modo hermético. No son resultados históricos.

| Comando | Exit | Resultado |
| --- | --- | --- |
| `npm run validate:migration-files` | 0 | 76 archivos, 76 versiones únicas, sin duplicados |
| `npm run lint` | 0 | 0 errores, 119 warnings (`no-explicit-any` en pruebas) + typecheck limpio |
| `npm test` | 0 | 312 archivos pasados / 11 omitidos (323) · 3266 pruebas / 97 omitidas (3363) · ~147 s |
| `npm run build` | 0 | vite + esbuild OK |
| `npm audit --omit=dev` | 0 | 0 vulnerabilidades |

Los 11 archivos omitidos son suites de contrato que requieren una Supabase real; se omiten por diseño y no son fallos.

**No ejecutados** (requieren infraestructura externa): `test:db`, `test:db:billing`, `test:auth`, `test:db:postgres17` local (los fixtures PG17 sí corren en CI), `validate-production-readiness`, `validate-restore-checklist`, `report-migration-drift` contra staging.

## Fuentes canónicas

| Necesidad | Documento |
| --- | --- |
| Reactivación automática por pago | [`../operations/automatic-payment-reactivation.md`](../operations/automatic-payment-reactivation.md) |
| Plan de puesta en producción | [`../PRODUCTION_LIVE_MASTER_PLAN.md`](../PRODUCTION_LIVE_MASTER_PLAN.md) |
| Checklist de producción | [`../deployment/PRODUCTION_READINESS_CHECKLIST.md`](../deployment/PRODUCTION_READINESS_CHECKLIST.md) |
| Sincronización de migraciones (fechado 2026-07-30) | [`../deployment/SUPABASE_MIGRATIONS_SYNC.md`](../deployment/SUPABASE_MIGRATIONS_SYNC.md) |
| Variables de runtime de producción | [`../deployment/PRODUCTION_RUNTIME_ENV_CHECKS.md`](../deployment/PRODUCTION_RUNTIME_ENV_CHECKS.md) |
| Retrospectiva 15–29 julio (histórico) | [`REPO_REVIEW_2026-07-15_29.md`](./REPO_REVIEW_2026-07-15_29.md) |

Los documentos de `docs/results/` son evidencia histórica fechada de validaciones concretas. Conservan su fecha a propósito y **no describen el estado de hoy**.

## Guardrails

- No aplicar migraciones, ejecutar RouterOS live ni provisionar de verdad sin autorización explícita.
- No usar `supabase db push`; las migraciones van por `psql` al pooler.
- No publicar secretos, JWTs, contraseñas, claves ni hosts privados.
- Toda validación de staging debe confirmar primero que el commit está en `origin/main`.
- No presentar mocks ni resultados históricos como validación actual.
