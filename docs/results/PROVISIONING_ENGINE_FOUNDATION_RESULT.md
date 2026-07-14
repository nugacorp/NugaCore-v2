# PROD-7 Provisioning Engine Foundation Result

Fecha: 2026-06-24
Rama: main

## Resultado

Se agrego el dominio `backend/domains/provisioning` como foundation dry-run para calcular, registrar y auditar acciones de provisioning sin cambios reales.

## Alcance

- Acciones: `SUSPEND_CUSTOMER`, `REACTIVATE_CUSTOMER`, `CHANGE_PLAN`, `CREATE_CUSTOMER`, `CANCEL_CUSTOMER`.
- Estados: `PENDING`, `VALIDATED`, `SIMULATED`, `APPROVED`, `REJECTED`, `CANCELLED`.
- Rutas: `/api/provisioning/actions`, `/api/provisioning/actions/:id`, `/api/provisioning/summary` y transiciones `validate`, `simulate`, `approve`, `reject`, `cancel`.
- RBAC: lectura para los seis roles; escritura solo Super Admin, Administrador y Cobranza.
- UI: `Provisioning Center` bajo MikroTik, con badge `DRY RUN`, banner de no cambios reales, tabla, detalle de plan y botones de transicion.
- Client 360: seccion Provisioning con ultima accion, estado, fecha, resultado de simulacion y acceso a historial.
- Dashboard: KPI `Provisioning Pendiente` basado en `PENDING + VALIDATED + SIMULATED`.

## Safety

No se agrego integracion RouterOS, Worker Live, SSH, shell ni acciones reales sobre routers. El test `provisioning.static-safety.test.ts` protege los archivos nuevos del modulo.

## Validacion

- `npm run typecheck`
- `npm test`
- `npm run build`
