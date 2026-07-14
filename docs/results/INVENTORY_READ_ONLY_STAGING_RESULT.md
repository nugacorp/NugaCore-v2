# Inventory Read-Only Foundation — Staging Result

Fecha UTC: 2026-06-19T04:42:57Z

## Alcance

Validación de Fase 4.11.1: base read-only para consultar inventario de routers desde el modelo MikroTik reconciliado.

Restricciones respetadas:

- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó commit mode ni escritura real MikroTik.
- No se ejecutó RouterOS.
- No se tocaron routers reales.
- No se aplicaron migraciones en esta fase.
- No se hizo provisioning real.

## Commit validado

- `6b825f3 feat(inventory): add read-only router inventory foundation`

Deploy staging:

- Imagen/commit activo: `6b825f387e6d8bb1d0bb420d11896e36c6a0e42d`.
- Contenedor Coolify: healthy.

## Healthchecks

Base URL:

- `https://nugacore-staging.5.180.151.109.sslip.io`

Resultados:

- `/api/health`: 200, status `ok`.
- `/api/health/live`: 200, status `ok`.
- `/api/health/ready`: 200, status `ready`.

## Flags runtime

Verificados dentro del contenedor staging, sin imprimir secretos:

- `USE_DB_MIKROTIK`: UNSET / apagado.
- `USE_DB_WIREGUARD`: UNSET / apagado.
- `MIKROTIK_WORKER_LIVE`: `false`.
- `MIKROTIK_COMMIT_MODE`: UNSET / apagado.
- `MIKROTIK_WRITE_ENABLED`: UNSET / apagado.

## Checks locales

Comandos ejecutados:

```bash
npm run typecheck
npm test
npm run build
```

Resultados:

- `npm run typecheck`: PASS.
- `npm test`: PASS; 59 archivos passed, 7 skipped; 1055 tests passed, 46 skipped.
- `npm run build`: PASS.

## Endpoints read-only

Endpoints validados con login real/JWT real de staging por rol:

- `GET /api/inventory/routers`
- `GET /api/inventory/routers/:id`
- `GET /api/inventory/summary`

RBAC validado:

| Rol | routers | summary | detail inexistente |
| --- | --- | --- | --- |
| Super Admin | 200 | 200 | 404 |
| Administrador | 200 | 200 | 404 |
| Técnico | 200 | 200 | 404 |
| Soporte | 200 | 200 | 404 |
| Solo lectura | 200 | 200 | 404 |
| Cobranza | 403 | 403 | 403 |

Validaciones de payload:

- `summary` responde correctamente.
- `routers` responde array.
- `detail` de router inexistente devuelve 404 para roles permitidos.
- Payload no expone `encrypted_password`, objetos de credenciales, tokens, private keys, preshared keys ni scripts.
- El campo booleano `hasCredentials` puede aparecer como indicador seguro; no expone credenciales.

## Sin escritura

Métodos probados con usuario permitido:

| Método | Endpoint | Resultado |
| --- | --- | --- |
| POST | `/api/inventory/routers` | 404 |
| PUT | `/api/inventory/routers/:id` | 404 |
| PATCH | `/api/inventory/routers/:id` | 404 |
| DELETE | `/api/inventory/routers/:id` | 404 |

Resultado: PASS. No hay endpoints de escritura Inventory Routers.

## UI

Validación realizada:

- Login real en staging con Super Admin.
- Módulo `Inventario Routers (Read-Only)` visible en sidebar.
- Vista `Inventario de Routers` abre correctamente.
- Badge `READ-ONLY` visible.
- Resumen visible.
- Tabla de routers visible cuando hay datos.
- Copy explícito indica que la vista no modifica routers, no ejecuta RouterOS y no envía comandos.
- No se observaron botones de escritura en la vista.

Validación complementaria incluida en `npm test`:

- `tests/unit/inventory.routers.ui.test.ts` confirma que el módulo está declarado como read-only.
- Confirma endpoints frontend solo GET/read-only.
- Confirma ausencia de métodos `POST`, `PUT`, `DELETE`, `PATCH` dentro del módulo Inventory Routers.
- Confirma visibilidad para Super Admin, Administrador, Técnico, Soporte y Solo lectura.
- Confirma que Cobranza no tiene el tab `inventory-routers` en RBAC frontend.

Bundle desplegado validado con no-cache:

- Contiene `Inventario Routers`.
- Contiene `READ-ONLY`.
- Contiene `/api/inventory/summary`.
- Contiene `/api/inventory/routers`.
- Contiene empty state `No hay routers en el inventario`.

## Seguridad y logs

Logs recientes del contenedor revisados sin imprimir secretos.

No se detectaron:

- JWTs.
- `service_role`.
- `MIKROTIK_CREDENTIALS_KEY` como valor/log sensible.
- `encrypted_password`.
- Private keys.
- Preshared keys.
- Scripts RouterOS completos.

Resultado: PASS.

## Resultado final

✅ FASE 4.11.1 APROBADA

Inventory Read-Only Foundation quedó validado en staging sin activar MikroTik DB runtime, WireGuard DB runtime, Worker live, commit mode ni tocar routers reales.
