# DB-1 MikroTik Schema Reconciliation — Staging Result

Fecha UTC: 2026-06-19T03:45:27Z

## Alcance

Validación DB-1 de la migración evolutiva y estricta para `public.mikrotik_routers`.

Restricciones respetadas:

- No se activó `USE_DB_MIKROTIK`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó commit mode ni escritura real MikroTik.
- No se tocaron routers reales.
- No se ejecutó RouterOS.
- No se aplicó provisioning real.
- No se borraron datos.

## Commit validado

Commit solicitado:

- `1360cfa fix(mikrotik): restrict schema reconciliation migration contract`

HEAD local al momento de validación:

- `bd64709 docs(mikrotik): add Hermes DB-1 runbook for strict-contract migration`

`1360cfa` aparece en `main` y está incluido en el HEAD validado.

## Migración aplicada

Archivo:

- `supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql`

Aplicación:

- Aplicada en Supabase staging mediante mecanismo SQL seguro equivalente.
- `NOTIFY pgrst, 'reload schema';` ejecutado después de aplicar la migración.

Pre/post conteo seguro:

- `public.mikrotik_routers`: 0 filas antes de la aplicación.
- `public.mikrotik_routers`: 0 filas después de la aplicación.

Resultado:

- PASS: la migración aplicó sin errores.
- PASS: no hubo borrado de datos.
- PASS: los índices canónicos existen.

## Contrato estricto de migración

SQL ejecutable permitido encontrado:

- `ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS ...`
- `CREATE INDEX IF NOT EXISTS ...`

SQL prohibido ausente como sentencia ejecutable:

- `DO $$`
- `CREATE TRIGGER`
- `BEFORE UPDATE`
- `ENABLE ROW LEVEL SECURITY`
- `COMMENT ON`
- `DROP`
- `DELETE`
- `TRUNCATE`
- `UPDATE`
- `INSERT`

Nota: existe una columna llamada `updated_at`; eso no es una sentencia `UPDATE` ni modifica datos.

Resultado: PASS.

## Validación de esquema

Comando:

```bash
RUN_DB_TESTS=true node scripts/validate-mikrotik-schema.mjs
```

Resultado:

- PASS: 28 OK, 0 fallidos.
- Tabla `mikrotik_routers` validada.
- Columnas de monitoreo conservadas.
- Columnas de provisioning presentes.
- Tablas auxiliares esperadas validadas.

## Pruebas

Comandos ejecutados:

```bash
RUN_DB_TESTS=true npm run test:db
npm run typecheck
npm test
npm run build
```

Resultados:

- `validate-mikrotik-schema`: PASS.
- `test:db`: PASS en re-ejecución con entorno local de test que permite headers de rol para `supertest`; 5 archivos, 33 tests passed.
- `npm run typecheck`: PASS.
- `npm test`: PASS; 56 archivos passed, 7 skipped; 1028 tests passed, 46 skipped.
- `npm run build`: PASS.

Observación operativa:

- Una primera ejecución de `test:db` con el entorno shell cargado sin override local de test falló en `router-enrollment.db.contract.test.ts` con `401` al crear un servidor WireGuard de prueba, porque `AUTH_TRUST_HEADERS` no estaba habilitado para el harness local de `supertest`.
- La re-ejecución se hizo con `NODE_ENV=test` y `AUTH_TRUST_HEADERS=true` solo para el proceso local de pruebas. No se modificaron flags de staging ni runtime.

## Flags verificados en runtime

Contenedor staging revisado sin imprimir secretos.

- `USE_DB_MIKROTIK`: UNSET / apagado.
- `MIKROTIK_WORKER_LIVE`: `false`.
- `MIKROTIK_COMMIT_MODE`: UNSET / apagado.
- `MIKROTIK_WRITE_ENABLED`: UNSET / apagado.
- `USE_DB_ROUTER_ENROLLMENT`: `true` y se dejó sin cambios, como estaba permitido.

## Healthchecks staging

URL base:

- `https://nugacore-staging.5.180.151.109.sslip.io`

Resultados:

- `/api/health`: 200, status `ok`.
- `/api/health/live`: 200, status `ok`.
- `/api/health/ready`: 200, status `ready`.

## Seguridad y log hygiene

Logs recientes revisados sin imprimir secretos.

No se detectaron:

- JWTs.
- `service_role`.
- `MIKROTIK_CREDENTIALS_KEY` como valor/log sensible.
- Passwords.
- Private keys.
- Preshared keys.
- Scripts RouterOS completos.

Resultado: PASS.

## Resultado final

✅ DB-1 APROBADA

La migración estricta de reconciliación de `mikrotik_routers` quedó aplicada y validada en staging, sin activar runtime DB MikroTik, Worker live, commit mode ni tocar routers reales.
