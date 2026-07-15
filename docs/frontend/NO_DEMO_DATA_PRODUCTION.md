# Sin datos demo en staging/producción

Fecha: 2026-07-15

## Regla

Con `SEED_DEMO_DATA=false` o `PUBLIC_DEPLOYMENT=true` el store **no** sirve:

- Torres ficticias (Ajusco, San Pedro, del Valle)
- OLT/ONU/NAP de muestra
- Clientes/tickets/facturas/inventario en memoria de demo
- Routers MikroTik inventados `mkt-1/2/3`

El dashboard debe mostrar empty states honestos hasta que existan sitios/routers/UISP reales.

## Deploy

`scripts/vps/deploy-coolify-staging.sh` fuerza `SEED_DEMO_DATA=false`.

## Nota clientes en Supabase

Si `USE_DB_CUSTOMERS=true`, los KPIs de clientes (activos / MRR) vienen de la base, no del store.

- **MRR** = suma del precio del plan de clientes con estatus `active` o `suspended`.
- **Baja** en CRM solo cambia el estatus (deja de contar en MRR, pero la ficha sigue).
- **Eliminar permanentemente** (Super Admin / Administrador) hace `DELETE /api/clients/:id` y borra la fila en Supabase.

Cualquier fila de prueba en Supabase hay que limpiarla desde CRM → Eliminar (no es seed del proceso Node).
