# NugaCore — Análisis para Producción Real (desde hoy)

**Fecha de creación:** 2026-07-08  
**Branch analizado:** `cursor/wisp-os-full-plan-0ffb`  
**Commit de referencia:** `c72adb9`

---

## 1) Resumen ejecutivo

NugaCore ya está **muy avanzado funcionalmente** como WISP OS (olas 0–6 implementadas a nivel producto/staging), pero **aún no está listo para operación real** de un WISP en producción.

Lo que falta no es “más UI”, sino cerrar gates de operación real:

1. **Persistencia y restore verificados en entorno real**
2. **Hardening de seguridad y auth para producción**
3. **Integraciones reales de dinero (pagos/CFDI)**
4. **Integraciones reales de red (MikroTik live, NOC telemetría real)**
5. **Runbooks de despliegue, rollback y monitoreo con evidencia**

---

## 2) Estado actual (hoy)

### Ya logrado
- Olas 0–6 del plan maestro implementadas en código y documentación.
- Contratos y pruebas amplias pasando (typecheck/tests/build).
- Dashboard/control-center, CRM/Client360, cobranza, comercial, portal/PWA, GIS/NOC, reportes y bases de RADIUS/tenancy.
- Gates de seguridad operativa conservados (dry-run, live bloqueado por defecto).

### Aún faltante para “producción real”
- Cierre total de checklist de producción (`docs/PRODUCTION_READINESS_CHECKLIST.md`) con evidencia.
- Validación en staging real con credenciales, flags críticos y restore probado.
- Integraciones live pendientes por diseño: pagos reales, CFDI/PAC, notificaciones reales, RouterOS write/live.

---

## 3) Qué falta, paso por paso (orden recomendado)

## Paso 1 — Cerrar **OLA 0 real** en staging con evidencia
**Objetivo:** garantizar que no se pierde estado y que el sistema sobrevive reinicios/deploys.

Acciones:
1. Aplicar migraciones pendientes en staging.
2. Activar flags críticos `USE_DB_*` según `docs/STAGING_FLAGS_WISP_OS.md`.
3. Verificar:
   - `GET /api/system/persistence-status` -> `storeFallbackActive: false`
   - `GET /api/system/staging-readiness` -> `ola0PersistenceClosed: true`
4. Ejecutar jobs/scripts de validación (`validate-staging-readiness`, `validate-wisp-os-staging`, `validate-restore-checklist`).
5. Hacer backup+restore real en staging y marcar `STAGING_RESTORE_TESTED=true`.

Salida esperada:
- Evidencia documentada de restore exitoso.
- Persistencia crítica cerrada de extremo a extremo.

---

## Paso 2 — Hardening de seguridad para producción
**Objetivo:** eliminar vectores de acceso no seguro antes de exponer tráfico real.

Acciones:
1. Confirmar `AUTH_TRUST_HEADERS=false` en producción.
2. Forzar JWT/RBAC real en endpoints críticos.
3. Confirmar CORS allowlist, rate limit, headers de seguridad y HTTPS/HSTS.
4. Probar matriz de roles (allow/deny) con usuarios reales de producción.

Salida esperada:
- Checklist de seguridad cerrado con pruebas de autorización por rol.

---

## Paso 3 — Dinero real (billing + payments + fiscal)
**Objetivo:** que facturar/cobrar/reactivar sea confiable en operación diaria.

Acciones:
1. Validar datos reales: facturas/pagos huérfanos = 0.
2. Activar y probar webhooks reales con idempotencia.
3. Conciliación y trazabilidad de pagos.
4. Integrar CFDI/PAC (si entra en el release de producción).

Salida esperada:
- Flujo financiero completo, auditable, y sin dependencia de mocks.

---

## Paso 4 — Red real con disciplina (no salto directo a live)
**Objetivo:** pasar de observabilidad/simulación a ejecución controlada.

Acciones:
1. Mantener secuencia: **Ver -> Auditar -> Simular -> Confirmar -> Ejecutar -> Automatizar**.
2. Validar Worker/MikroTik en dry-run total con evidencia.
3. Habilitar live gradual solo con aprobación explícita y rollback probado.
4. NOC: mover telemetría a fuentes reales (SNMP/syslog/netflow según fase).

Salida esperada:
- Operación de red live controlada, reversible y auditada.

---

## Paso 5 — Portal cliente y app técnicos a nivel producción
**Objetivo:** endurecer capa de experiencia final.

Acciones:
1. Portal: pasar de token staging a auth cliente real (JWT/Supabase).
2. PWA técnicos: robustecer sincronización offline con manejo de conflictos/reintentos.
3. Validación de carga y operación en campo.

Salida esperada:
- Portal y PWA aptos para uso real de clientes/técnicos.

---

## Paso 6 — Operación de plataforma (release management)
**Objetivo:** evitar “funciona hoy, falla mañana”.

Acciones:
1. Pipeline formal de deploy a producción (promoción desde staging).
2. Runbook de rollback probado.
3. Monitoreo y alertado operativo de API/jobs/workers.
4. Política de cambios (gates y responsables por fase).

Salida esperada:
- Producción operable por equipo, no dependiente de una sola persona.

---

## 4) Bloqueadores principales al día de hoy

1. **No hay evidencia cerrada de restore real** para declarar producción.
2. **Integraciones live críticas siguen en dry-run/mock** (pagos/notificaciones/red).
3. **NOC y RouterOS live** todavía en fase controlada, no productiva.
4. **Portal auth de cliente** aún no en modo producción final.

---

## 5) Definición práctica de “listo para producción”

Se considera “listo” cuando se cumpla todo lo siguiente:

- Persistencia crítica + restore comprobados con evidencia.
- Seguridad/RBAC hardening cerrados.
- Dinero real funcionando e idempotente.
- Red live habilitada de forma gradual, auditada y con rollback.
- Deploy/rollback/monitoreo operativos documentados y ejecutados al menos una vez.

---

## 6) Recomendación inmediata (siguiente iteración)

Priorizar en este orden:

1. **Cierre OLA 0 real en staging (evidencia de restore)**
2. **Security hardening final de producción**
3. **Pagos/webhooks reales**
4. **MikroTik live gradual (gated)**

Si esos 4 puntos no están cerrados, todavía no conviene declarar producción real.

