# Payments Auth Headers Hotfix — Result

Fecha: 2026-06-21

## Problema

Durante la validación de UX Simplification en staging, abrir el módulo **Pagos**
producía:

- `GET /api/payments/orders` → HTTP 401.
- `GET /api/payments/actions` → HTTP 401.

El mismo riesgo afectaba las mutaciones del módulo:

- `POST /api/payments/orders`.
- `POST /api/payments/customers/:id/reactivate`.

## Causa

`PaymentsModule` construía headers locales con:

- `x-user-role`.
- `x-user-id`.

Estos trusted headers solo son una facilidad de desarrollo. En
staging/producción se ignoran y la identidad debe proceder de un Bearer JWT
verificado.

## Fix

- `PaymentsModule` recibe ahora la prop obligatoria `getAuthHeaders`.
- Las lecturas de órdenes y acciones obtienen una vez los headers de sesión y
  los reutilizan en el `Promise.all`.
- La creación de órdenes y la reactivación usan
  `...(await getAuthHeaders())` más `Content-Type: application/json`.
- Se eliminaron por completo `x-user-role`, `x-user-id` y el helper local
  `authHeaders` del módulo.
- `App.tsx` conecta `getAuthHeaders={getAuthHeaders}` al renderizar Pagos.

No se modificó backend, RBAC, RouterOS ni infraestructura.

## Endpoints corregidos

| Método | Endpoint |
| --- | --- |
| GET | `/api/payments/orders` |
| GET | `/api/payments/actions` |
| POST | `/api/payments/orders` |
| POST | `/api/payments/customers/:id/reactivate` |

## RBAC

La visibilidad y escritura existentes se conservaron:

- Super Admin, Administrador y Cobranza pueden ver/escribir en Pagos.
- Técnico, Soporte y Solo lectura no obtienen acceso al tab Pagos.
- `canWritePayments` permanece sin cambios.

## Tests

Se agregó `tests/unit/payments.auth-headers.ui.test.ts` para verificar:

- Prop `getAuthHeaders` obligatoria.
- Uso de `getAuthHeaders` en orders y actions.
- Uso de `getAuthHeaders` en creación y reactivación.
- Ausencia de `x-user-role` y `x-user-id`.
- Cableado desde `App.tsx`.
- Visibilidad RBAC sin regresiones.
- `canWritePayments` sin regresiones.

Validación final:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 85 archivos pasaron.
  - 7 archivos omitidos por configuración.
  - 1331 tests pasaron.
  - 46 tests omitidos por configuración.
- `npm run build`: PASS.
  - Vite transformó 1762 módulos.
  - Bundle frontend y servidor generados correctamente.

## Limitación operativa

La alerta de cambio de SSH host key observada por Hermes sigue pendiente de
verificación por el operador. Este hotfix no toca la host key, el VPS, Coolify
ni staging infra. Hermes deberá redeployar/revalidar el módulo Pagos mediante un
canal de acceso confiable.

No avanzar a PROD-5 desde este hotfix.
