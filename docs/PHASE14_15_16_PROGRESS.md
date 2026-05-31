# Fases 14-16 Progress (backend-first, sin rediseño UI)

## Scope
- Stack preservado: React + Vite + TypeScript + Express.
- Sin cambios de layout, colores ni componentes visuales.
- Implementación en orden: Fase 14 -> Fase 15 -> Fase 16.

## Fase 14 - Reportes (CSV, Excel, PDF)

### Implementado
- Nuevo dominio de reportes:
  - `GET /api/reports/catalog`
  - `GET /api/reports/summary`
  - `GET /api/reports/export?scope=<financial|operational|security>&format=<csv|xlsx|pdf>`
- Exportación real por formato:
  - CSV: serialización tabular
  - XLSX: generación de workbook con `xlsx`
  - PDF: generación binaria de documento PDF de resumen
- Scopes soportados:
  - `financial`: facturación, pagos y pendientes
  - `operational`: torres, estado operativo y tickets activos
  - `security`: bitácora de seguridad/auditoría

### Seguridad de acceso
- `reports.view` para catálogo/resumen
- `reports.export` para exportación

## Fase 15 - Automatizaciones

### Implementado
- Nuevo dominio de automatizaciones:
  - `GET /api/automations/rules`
  - `POST /api/automations/rules`
  - `PUT /api/automations/rules/:id`
  - `DELETE /api/automations/rules/:id`
  - `POST /api/automations/run`
- Motor de reglas inicial:
  - `vencimiento`: suspensión automática por facturas vencidas
  - `pago`: reactivación automática por regularización
  - `suspension`: alerta de seguimiento para cartera suspendida
  - `alerta`: disparo automático por latencia/estado degradado
- Persistencia en memoria de reglas (`AUTOMATION_RULES`) con `lastRunAt`.

### Seguridad de acceso
- `automation.manage` para CRUD de reglas
- `automation.execute` para ejecución manual del motor

## Fase 16 - Seguridad y auditoría avanzada

### Implementado
- Bitácora completa de acciones API:
  - middleware global `attachSecurityAudit` en backend
  - registro de método, recurso, actor, status, origen, éxito y duración
  - almacenamiento en `SECURITY_AUDIT_LOGS`
- Permisos por acción:
  - matriz de permisos centralizada por action key
  - middleware `requireAction(...)`
- Política de backups:
  - `GET /api/security/backup-policy`
  - `PUT /api/security/backup-policy`
  - `POST /api/security/backup/run`
  - almacenamiento en `BACKUP_POLICY`
- Endpoints de seguridad:
  - `GET /api/security/audit-logs`
  - `GET /api/security/permission-matrix`
  - `GET /api/security/secrets/status` (cobertura de secretos cifrados)

## Archivos principales
- `backend/domains/reports/routes.ts`
- `backend/domains/automations/routes.ts`
- `backend/domains/security/routes.ts`
- `backend/common/action-permissions.ts`
- `backend/common/security-audit.ts`
- `backend/common/rbac.ts`
- `backend/state/store.ts`
- `backend/register-routes.ts`
- `backend/app.ts`
- `package.json`
- `package-lock.json`

## Validación
- `npm run lint`: OK
- `npm run build`: OK
- Se mantiene warning no bloqueante de chunk size en Vite.

## Nota
- La instalación de dependencias reportó 1 vulnerabilidad alta vía `npm audit` (informativo, no bloqueó build).
