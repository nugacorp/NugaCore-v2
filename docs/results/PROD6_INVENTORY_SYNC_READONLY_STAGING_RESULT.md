# PROD-6 Inventory Sync Read-Only — staging result

Fecha de validación: 2026-06-23

## Resultado final

✅ PROD-6 INVENTORY SYNC READ-ONLY APROBADA

Alcance respetado:

- No se avanzó a PROD-7.
- No se activó Worker Live.
- No se activó RouterOS Write.
- No se activó USE_DB_MIKROTIK.
- No se activó USE_DB_WIREGUARD.
- No se tocaron routers reales.
- No se aplicaron migraciones.

## Commit validado

Commit solicitado presente en `main` y en el artefacto validado por inclusión:

- `e477e3d feat(prod6): add inventory sync read-only foundation`

Durante la validación se detectaron dos ajustes seguros de contrato/UI, ambos read-only y sin tocar routers ni migraciones:

- `7397386 fix(prod6): expose inventory sync snapshot contract aliases`
- `3ff7f75 fix(prod6): label inventory sync refresh as read-only`

Artefacto final desplegado en staging: `3ff7f75`, que incluye `e477e3d`.

## Deploy y health

Redeploy de staging ejecutado mediante Coolify contra `main` actual.

Validaciones:

- Contenedor: `running/healthy`.
- Imagen desplegada: `3ff7f75...`.
- `GET /api/health`: 200.
- `GET /api/health/live`: 200.
- `GET /api/health/ready`: 200.

## Flags peligrosos

Validado dentro del contenedor, sin imprimir secretos:

- `USE_DB_MIKROTIK`: `UNSET`.
- `USE_DB_WIREGUARD`: `UNSET`.
- `MIKROTIK_WORKER_LIVE`: `OFF`.
- `MIKROTIK_COMMIT_MODE`: `UNSET`.
- `MIKROTIK_WRITE_ENABLED`: `UNSET`.
- `ROUTEROS_READONLY_PROVIDER`: `mock`.

## Checks locales

Ejecutados en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS.
- `npm test`: PASS — 101 test files passed, 7 skipped; 1431 tests passed, 46 skipped.
- `npm run build`: PASS.

## Endpoints Inventory Sync

Endpoints validados en staging con JWT real:

- `GET /api/inventory-sync/status`
- `GET /api/inventory-sync/snapshot`
- `GET /api/inventory-sync/differences`

## RBAC

Resultado con JWT real:

| Rol | Resultado |
| --- | --- |
| Super Admin | 200 en los 3 endpoints |
| Administrador | 200 en los 3 endpoints |
| Técnico | 200 en los 3 endpoints |
| Soporte | 200 en los 3 endpoints |
| Solo lectura | 200 en los 3 endpoints |
| Cobranza | 403 en los 3 endpoints |

## Payloads

`GET /api/inventory-sync/status`:

- Incluye `lastSyncAt`.
- Incluye `source`.
- Incluye `status` general (`IN_SYNC` / `OUT_OF_SYNC`).
- Incluye `totalDifferences`.
- Incluye `countsByType`.
- Resultado observado: `source=mock`, `status=OUT_OF_SYNC`, `totalDifferences=6`.

`GET /api/inventory-sync/snapshot`:

- Incluye `nugaCoreInventory`.
- Incluye `routerosSnapshot`.
- Incluye `source`.
- Mantiene aliases de compatibilidad UI: `nugacore` y `routeros`.
- Resultado observado: `source=mock`.

`GET /api/inventory-sync/differences`:

- Incluye `differences[]`.
- Incluye `total`.
- Resultado observado: `total=6`.

Tipos de diferencia soportados por contrato:

- `ROUTER_MISSING`
- `INTERFACE_MISSING`
- `INTERFACE_EXTRA`
- `ROUTE_MISSING`
- `ROUTE_EXTRA`
- `WIREGUARD_PEER_MISSING`
- `WIREGUARD_PEER_EXTRA`

Datos mock actuales mostraron diferencias presentes para todos excepto `ROUTER_MISSING`; el tipo está definido y cubierto como parte del enum/contrato.

## Fallback

Con provider efectivo `mock`:

- Los 3 endpoints devuelven 200 para roles permitidos.
- `source=mock`.
- No se observaron 500.
- La UI renderiza sin romperse.

## Write protection

Métodos probados contra cada endpoint:

- `POST`
- `PUT`
- `PATCH`
- `DELETE`

Endpoints:

- `/api/inventory-sync/status`
- `/api/inventory-sync/snapshot`
- `/api/inventory-sync/differences`

Resultado esperado cumplido tras reintento estable post-deploy:

- Todos respondieron 404 para rutas/métodos no definidos.
- Ningún método de escritura respondió 200.
- No hubo modificación de estado.

## Static safety

Escaneo de `backend/domains/inventory-sync/**`:

No contiene coincidencias para:

- `.add(`
- `.set(`
- `.remove(`
- `.execute(`
- `/ip firewall add`
- `/ip route add`
- `/queue simple add`
- `/ppp secret add`
- `/interface add`
- `/tool fetch`

## UI

Validación UI:

- El módulo aparece en navegación bajo sección MikroTik como `Inventory Sync`.
- Badge `READ ONLY` visible.
- Banner visible: `Esta funcionalidad no modifica routers.`
- Muestra `Última sincronización`.
- Muestra `Diferencias`.
- Muestra `Estado general`.
- Muestra tabla `Tipo / Router / Elemento / Estado`.
- Muestra fuente `MOCK` / `ROUTEROS`; fuente observada: `MOCK`.
- No hay acciones de escritura del módulo.
- El botón de recarga se rotuló como `Actualizar lectura`, no como acción de escritura.
- No hay acción `execute`, `apply`, `fix` ni `sync write` en el módulo.

## Seguridad y logs

Logs recientes revisados con escaneo por patrones, sin imprimir contenido sensible.

Ausencia confirmada de:

- JWTs.
- Service role.
- Passwords.
- Private keys.
- Preshared keys.
- Scripts RouterOS write completos.
- Credenciales RouterOS.

Payloads de los endpoints también fueron escaneados por patrones sensibles y pasaron.

## Notas

- Se mantuvo `ROUTEROS_READONLY_PROVIDER=mock` durante la validación.
- La validación fue read-only respecto a routers e infraestructura de red.
- No se ejecutaron comandos RouterOS contra routers reales.
