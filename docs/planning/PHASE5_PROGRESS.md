# Fase 5 - Suspension y Reactivacion Simulada (sin cambios UI)

## Objetivo
Aplicar reglas operativas de suspension/reactivacion sin acciones destructivas reales en MikroTik, con bitacora y endpoints listos para futura integracion real.

## Implementado

### 1. Politica de suspension
- Modelo en memoria `SUSPENSION_POLICY` con:
  - `enabled`
  - `graceDays`
  - `allowAutoReactivateOnPayment`
- Endpoints:
  - `GET /api/suspension/policy`
  - `PUT /api/suspension/policy`

### 2. Motor de reglas simuladas
- Endpoint de ejecucion:
  - `POST /api/suspension/run`
- Comportamiento:
  - Suspende clientes con facturas `overdue` fuera de ventana de gracia.
  - Reactiva clientes suspendidos cuando se regulariza saldo y la politica lo permite.

### 3. Operacion manual
- Endpoints manuales:
  - `POST /api/suspension/clients/:id/suspend`
  - `POST /api/suspension/clients/:id/reactivate`

### 4. Bitacora operativa
- Nueva bitacora `SUSPENSION_ACTION_LOGS` para trazabilidad.
- Endpoint:
  - `GET /api/suspension/logs`
- Se registran eventos de tipo:
  - `suspend`
  - `reactivate`
  - `rule-scan`

### 5. Integracion con cobranza
- En pago de factura (`POST /api/billing/invoices/:id/pay`) la reactivacion automatica ahora respeta `allowAutoReactivateOnPayment`.
- Se agrega logging de suspension/reactivacion y timeline de cliente cuando aplica.

## Archivos
- `backend/domains/suspension/routes.ts`
- `backend/register-routes.ts`
- `backend/state/store.ts`
- `backend/domains/billing/routes.ts`

## Validacion
- `npm run lint`: OK
- `npm run build`: pendiente de ejecucion en este documento
