# Fase 2, 3 y 4 - Progreso (sin cambios UI)

## Paso 1 - Hardening auth backend
- Middleware global `attachAuthContext` agregado en backend.
- Verificacion de JWT Bearer via Supabase Admin (`auth.getUser`).
- Resolucion de rol server-side desde `user_roles -> roles`.
- RBAC consume `req.authContext.role` en lugar de confiar solo en headers.
- Fallback para entorno local: usa headers cuando Supabase Admin no esta configurado o `AUTH_TRUST_HEADERS=true`.

## Paso 2 - Fase 2 Clientes
- `GET /api/clients` con filtros por `status`, `type`, `city`, `planId`, `q`.
- `GET /api/clients/:id` agregado.
- `GET /api/clients/:id/history` agregado.
- `POST /api/clients` validaciones de campos, plan y tipo; alta con historial.
- `PUT /api/clients/:id` validaciones, cambios de estado y timeline.
- `DELETE /api/clients/:id` agregado con limpieza relacionada (invoices, onus, timeline).
- Store extendido con `CLIENT_TIMELINE`.

## Paso 3 - Fase 3 Planes
- `GET /api/plans` ahora soporta filtros por `q`, `status`, `businessType`.
- `GET /api/plans/:id` agregado.
- `POST /api/plans` CRUD con control de duplicados.
- `PUT /api/plans/:id` actualizado para edicion de velocidad, precio, tipo y metadata.
- `DELETE /api/plans/:id` con bloqueo si hay clientes asignados.
- Store extendido con `PLAN_METADATA` (`isActive`, `businessType`).

## Paso 4 - Fase 4 Cobranza
- `POST /api/billing/invoices/:id/pay` ahora soporta pagos parciales (`amount`).
- Saldo pendiente y estado sincronizados automaticamente (`paid`, `unpaid`, `overdue`).
- `GET /api/billing/invoices/:id/account-state` agregado.
- `GET /api/billing/account-summary` agregado.
- `GET /api/billing/revenue-report` agregado.
- Store extendido con `PAYMENT_ALLOCATIONS` para trazabilidad.

## Validacion final
- `npm run lint`: OK.
- `npm run build`: OK.
- UI no modificada en componentes visuales.
