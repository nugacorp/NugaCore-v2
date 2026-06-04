# Suspension Engine — Staging Validation Result

Fecha UTC: 2026-06-04T23:23:09Z
Ambiente: NugaCore Staging
URL: https://nugacore-staging.5.180.151.109.sslip.io
Commit validado: `3685349 feat(suspension): add automated suspension engine`
Resultado final: **FAIL**

## Alcance

Validación del Motor de Suspensiones Fase 4.5 en staging:

- Clasificación de clientes.
- Generación de órdenes.
- Generación de eventos.
- RBAC.
- Política.
- Idempotencia.
- Trazabilidad.
- Dashboard y UI.
- Confirmación de no ejecución real.

Restricciones respetadas:

- No se ejecutó Worker MikroTik.
- No se conectaron routers.
- No se tocaron routers reales.
- No se aplicaron cortes reales.
- No se modificó código.
- No se imprimieron secretos.

## 1. Commit y despliegue

PASS

Staging quedó en:

- `3685349 feat(suspension): add automated suspension engine`

Contenedor validado:

- Imagen `zmjc5lnl0wj3kh0uj14s2p4i:36853499b7dd8a7fafb322e425dce022b07f4253`
- Estado: `healthy`

## 2. Healthchecks

PASS

- `GET /api/health` -> 200
- `GET /api/health/live` -> 200
- `GET /api/health/ready` -> 200

## 3. RBAC

PASS

Validado con usuarios staging reales.

### Soporte

- `GET /api/suspension/customers` -> 403
- `GET /api/suspension/orders` -> 403
- `POST /api/suspension/evaluate-all` -> 403

### Solo lectura

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `GET /api/suspension/events` -> 200
- `POST /api/suspension/evaluate-all` -> 403
- `PUT /api/suspension/policies` -> 403

### Técnico

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `POST /api/suspension/evaluate-all` -> 403

### Cobranza

- `GET /api/suspension/customers` -> 200
- `POST /api/suspension/evaluate-all` -> 200
- `PUT /api/suspension/policies` -> 403

### Admin

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `GET /api/suspension/events` -> 200
- `GET /api/suspension/policies` -> 200
- `POST /api/suspension/evaluate-all` -> 200
- `PUT /api/suspension/policies` -> 200

### SuperAdmin

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `GET /api/suspension/events` -> 200
- `GET /api/suspension/policies` -> 200
- `POST /api/suspension/evaluate-all` -> 200
- `PUT /api/suspension/policies` -> 200

## 4. Política

PASS

`GET /api/suspension/policies` devolvió la política default:

- `graceDays = 3`
- `suspendAfterDue = true`
- `reactivateOnPayment = true`
- `reactivateOnPartialPayment = false`
- `autoReactivate = true`

Validaciones:

- `PUT graceDays = -1` -> 400
- `PUT graceDays = 5` como Admin -> 200
- Restauración default -> 200

## 5. Escenario A — cliente activo con factura vencida fuera de gracia

PASS

Dato usado: seed staging controlado del store del motor.

- Cliente: `c-5`
- Factura causante: `fac-105`
- Network status inicial: `active`
- Billing status: `DELINQUENT`
- Service status: `PENDING_SUSPENSION`
- Orden generada: `sord-1`
- Tipo: `suspension`
- Estado: `PENDING`
- Source: `engine`
- Reason: `Morosidad fuera de la ventana de gracia (3 días).`

El motor generó la orden pendiente sin ejecutar corte real.

## 6. Escenario B — cliente suspendido con factura pagada

FAIL / NO VALIDABLE EN STAGING ACTUAL

Resultado esperado:

- Cliente suspendido con factura pagada.
- `serviceStatus = PENDING_REACTIVATION`.
- `ReactivationOrder PENDING`.

Resultado observado:

- El seed disponible `c-4` está `suspended`, pero su factura `fac-103` está pendiente/vencida.
- El motor lo clasifica como:
  - `billingStatus = DELINQUENT`
  - `serviceStatus = SUSPENDED`
  - sin orden de reactivación

Bloqueo técnico:

- En staging están activos `USE_DB_CUSTOMERS=true` y `USE_DB_BILLING=true`.
- Las APIs de Customers/Billing escriben en Supabase.
- El Motor de Suspensiones Fase 4.5 evalúa `store.CLIENTS` y `store.INVOICES` en memoria.
- Por tanto, crear clientes/facturas por API o SQL no alimenta el dataset que usa el motor en runtime.
- No hay endpoint de diagnóstico/reset/seed para insertar un cliente suspendido con factura pagada dentro del store del motor sin modificar código.

Conclusión: el escenario B no se pudo validar end-to-end en staging sin romper la restricción de no modificar código.

## 7. Evaluate-all

PASS parcial

Primera ejecución:

- HTTP 200
- evaluated: 7
- suspensionOrders: 1
- reactivationOrders: 0
- changed: 5

Segunda ejecución:

- HTTP 200
- evaluated: 7
- suspensionOrders: 0
- reactivationOrders: 0
- changed: 0

Confirmado:

- Genera órdenes `PENDING`.
- Genera eventos.
- No ejecuta órdenes.
- No cambia `client.status`.
- No crea logs MikroTik nuevos.

Limitación: no se generó reactivation order porque el escenario B no existe en el store del motor.

## 8. Idempotencia

PASS para suspensión

Después de ejecutar `evaluate-all` dos veces:

- No duplicó la `SuspensionOrder` para `c-5`.
- No duplicó eventos equivalentes de creación de orden.
- Conservó trazabilidad.
- La segunda corrida devolvió `changed = 0` y `suspensionOrders = 0`.

No validado para reactivación por ausencia de escenario B en staging.

## 9. Trazabilidad

PASS para suspensión

Orden creada:

- customerId: `c-5`
- invoiceId: `fac-105`
- reason: `Morosidad fuera de la ventana de gracia (3 días).`
- status: `PENDING`
- source: `engine`
- createdAt: presente

Respuestas trazables:

- ¿Por qué se creó? Por morosidad fuera de ventana de gracia.
- ¿Qué factura la causó? `fac-105`.
- ¿Cuándo? `createdAt` de la orden.

No validado para reactivación por ausencia de escenario B.

## 10. Dashboard

FAIL parcial

`GET /api/dashboard-stats` respondió 200 e incluyó objeto `suspension`.

Valores observados:

- `suspendedToday`: presente
- `reactivatedToday`: presente
- `pendingSuspension`: presente
- `pendingReactivation`: presente
- `morosos`: presente

Problema:

- El requerimiento pedía la clave `delinquent`.
- La API devuelve `morosos` en lugar de `delinquent`.

Conclusión: KPIs funcionales presentes, pero contrato no coincide exactamente con el requerimiento.

## 11. UI

PASS parcial

Validado por fuente del componente y endpoints consumidos por la UI:

- Módulo: `Suspensiones & Cortes`.
- Header: `Motor de Suspensiones & Cortes`.
- Advertencia visible en copy: el motor decide/emite órdenes y no ejecuta cortes; el Worker MikroTik ejecutará en fase futura.
- Buckets implementados:
  - Activos
  - Advertencia
  - Por suspender
  - Suspendidos
  - Por reactivar
- Panel de clientes: `Estado de Clientes`.
- Panel de órdenes: `Órdenes Pendientes`.
- Panel de eventos: `Eventos Recientes`.
- Panel de política: `Política`.
- Botón: `Evaluar toda la cartera` para roles con permiso.
- Botón read-only/lock para roles sin permiso.

Limitación: la validación visual interactiva con login en navegador no se completó para evitar introducir o exponer credenciales en herramientas de navegador. La funcionalidad del botón se validó por API con rol Admin/Cobranza.

## 12. No ejecución real

PASS

Baselines antes/después de `evaluate-all`:

- MikroTik logs: 4 -> 4
- MikroTik command audit: 0 -> 0
- Worker MikroTik: sin procesos/contenedores detectados
- Órdenes creadas: `PENDING`
- `client.status` no cambió:
  - `c-5`: `networkStatus = active`
  - `c-4`: `networkStatus = suspended`

Confirmado:

- Ningún comando real MikroTik.
- Ningún Worker corriendo.
- Ningún router tocado.
- Ningún cambio de `client.status` por el motor.
- Órdenes quedan `PENDING`.

## 13. Limpieza

PASS

Acciones:

- Política restaurada a default.
- Contenedor reiniciado para limpiar estado in-memory de órdenes/eventos generados durante validación.

Validación posterior:

- `orders_after_cleanup = 0`
- `events_after_cleanup = 0`
- política default restaurada
- contenedor healthy

No se crearon clientes/facturas persistentes por la limitación del motor/store descrita arriba.

## 14. Tests

PASS

Ejecutado:

- `npm run typecheck` -> PASS
- `npm test` -> PASS
  - 23 test files passed
  - 252 tests passed
  - 5 files / 32 tests skipped por configuración existente
- `npm run build` -> PASS

## Riesgos restantes

1. El Motor de Suspensiones Fase 4.5 usa store en memoria mientras Customers/Billing están en modo DB en staging.
   - Esto impide preparar escenarios A/B por API o SQL de forma realista para el motor.
   - El escenario A existe solo porque el seed in-memory ya lo contiene.
   - El escenario B no existe y no pudo validarse end-to-end.

2. Contrato de dashboard no coincide con el requerimiento.
   - Requerido: `delinquent`.
   - Actual: `morosos`.

3. La idempotencia de reactivación no pudo validarse en staging actual.

4. UI validada parcialmente por código/API, no por sesión visual autenticada completa.

## Recomendación siguiente

No avanzar a Fase 4.6 ni al Worker MikroTik todavía.

Antes de avanzar:

1. Alinear el motor con la persistencia real de staging (`USE_DB_CUSTOMERS` / `USE_DB_BILLING`) o agregar un mecanismo seguro de seed/reset diagnóstico solo para staging.
2. Agregar fixture de cliente suspendido con factura pagada para validar reactivación.
3. Ajustar contrato de dashboard para incluir `delinquent` o actualizar el requerimiento a `morosos`.
4. Repetir validación end-to-end de:
   - reactivation order
   - idempotencia de reactivation order
   - UI autenticada completa

## Resultado final

**FAIL**

La fase no queda aprobada por:

- Escenario B no validable en staging actual.
- Dashboard devuelve `morosos` en lugar de `delinquent`.

No se avanzó al Worker MikroTik.
