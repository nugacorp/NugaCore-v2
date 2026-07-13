# Billing & Collections Foundation — staging result

Fecha de validación: 2026-06-23

## Resultado final

⚠️ BILLING & COLLECTIONS FOUNDATION NO APROBADA TODAVÍA por un gate global solicitado que no pasó completo:

- `RUN_DB_TESTS=true npm run test:db` falló en suites DB no pertenecientes a Billing (`router-enrollment.db` inicialmente por trusted headers no forzados y `inventory.db` por errores DB 500/400 aun forzando trusted headers).
- Las suites específicas de Billing DB sí pasaron.
- No se aplicaron migraciones, conforme a la restricción del pedido.

Todo lo específico de Billing/Foundation validado pasó en modo store y modo DB, pero no se ejecutó el commit documental porque la instrucción indicaba commitear solo si todo pasa.

## Alcance respetado

No se activó ni se ejecutó:

- RouterOS Write.
- Worker Live.
- MikroTik Runtime.
- Suspensiones reales.
- Proveedor de pago real.
- Stripe.
- MercadoPago.
- Migraciones.

## Commit validado

Commit solicitado presente en `origin/main` y desplegado:

- `ee47a53 feat(billing): Billing & Collections Foundation (WISP live)`

HEAD desplegado en staging:

- `ee47a533d9e24537d3d5677c433535d755016c39`

## Deploy staging

Redeploy ejecutado vía Coolify para la app staging.

Resultado:

- Contenedor: `running`.
- Health: `healthy`.
- Imagen desplegada: `ee47a533d9e24537d3d5677c433535d755016c39`.

Health checks:

- `GET /api/health`: 200.
- `GET /api/health/live`: 200.
- `GET /api/health/ready`: 200.

## Checks generales

Ejecutados en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 108 test files passed, 8 skipped.
  - 1554 tests passed, 49 skipped.
- `npm run build`: PASS.

## Flags runtime

Valores observados dentro del contenedor desplegado, sin imprimir secretos:

- `USE_DB_BILLING`: ON.
- `USE_DB_MIKROTIK`: UNSET.
- `USE_DB_WIREGUARD`: UNSET.
- `MIKROTIK_WORKER_LIVE`: OFF.
- `MIKROTIK_COMMIT_MODE`: UNSET.
- `MIKROTIK_WRITE_ENABLED`: UNSET.

Nota: staging ya estaba con `USE_DB_BILLING=true` al desplegar HEAD `ee47a53`. El modo store/default se validó con tests locales forzando `USE_DB_BILLING=false` sin tocar RouterOS.

## Store/default mode (`USE_DB_BILLING=false`)

Validación local con:

- `USE_DB_BILLING=false AUTH_TRUST_HEADERS=true npx vitest run tests/contract/billing.contract.test.ts tests/contract/rbac.billing.test.ts tests/contract/dashboard.billing.test.ts tests/contract/billing.secret-scan.test.ts --testTimeout=30000`

Resultado:

- 4 test files passed.
- 73 tests passed.

Cobertura validada en store/default:

- `GET /api/billing/invoices`.
- `GET /api/billing/invoices/:id`.
- `GET /api/billing/invoices/:id/account-state`.
- `GET /api/billing/customers/:customerId/balance`.
- `GET /api/billing/payments`.
- `GET /api/billing/account-summary`.
- `GET /api/billing/revenue-report`.
- `GET /api/dashboard/billing-kpis`.
- `POST /api/billing/invoices`.
- `POST /api/billing/invoices/:id/pay`.
- `POST /api/billing/invoices/:id/cancel`.
- `POST /api/billing/payments`.
- `POST /api/billing/run-cycle`.
- `PUT /api/billing/invoices/:id`.

Validación store/default importante:

- Contratos estables.
- Secret scan de respuestas billing: PASS.
- RBAC de lectura para todos los roles: PASS.
- Escritura limitada a Super Admin, Administrador y Cobranza: PASS.
- Técnico, Soporte y Solo lectura bloqueados con 403 en write: PASS.
- `run-cycle` es simulación y no toca RouterOS.

## `USE_DB_BILLING=true`

Staging desplegado con `USE_DB_BILLING=ON`.

Endpoints validados con JWT real:

- `GET /api/billing/invoices`: 200.
- `GET /api/billing/customers/:customerId/balance`: 200.
- `GET /api/billing/payments`: 200.
- `GET /api/billing/account-summary`: 200.
- `GET /api/billing/revenue-report`: 200.
- `GET /api/dashboard/billing-kpis`: 200.

Notas de `GET /api/billing/invoices/:id`:

- La lista DB estaba vacía al inicio de la validación, por lo que `fac-101` devolvió 404 antes de crear una factura test.
- Después de crear factura test, `GET /api/billing/invoices/:id` devolvió 200 y el mismo `id`.

Payloads sensibles:

- Respuestas billing escaneadas por patrones de JWT, service role, passwords, private keys, preshared keys, credentials y tokens: PASS.

## DB tests

Comando solicitado ejecutado:

- `RUN_DB_TESTS=true npm run test:db`

Resultado:

- FAIL global.
- Suites Billing DB pasaron:
  - `tests/contract/billing.schema.db.test.ts`: PASS.
  - `tests/contract/billing.db.contract.test.ts`: PASS.
- Otras suites DB no Billing fallaron:
  - `router-enrollment.db.contract.test.ts` falló inicialmente con 401 bajo el comando exacto.
  - `inventory.db.contract.test.ts` falló con 401 bajo el comando exacto.

Reintento diagnóstico seguro:

- Forzando `AUTH_TRUST_HEADERS=true`, `router-enrollment.db.contract.test.ts` pasó.
- `inventory.db.contract.test.ts` siguió fallando con errores 500/400 de inventario DB.
- No se aplicaron migraciones ni fixes fuera del alcance.

Por este motivo el gate global pedido no se considera aprobado.

## Persistencia Billing DB

Validada en staging con `USE_DB_BILLING=true` y JWT real:

1. Crear invoice test:
   - `POST /api/billing/invoices`: 201.
2. Leer invoice por id:
   - `GET /api/billing/invoices/:id`: 200.
   - `id` coincide.
3. Cancelar invoice:
   - `POST /api/billing/invoices/:id/cancel`: 200.
   - API devuelve `status=canceled`.
4. Confirmar persistencia directa en DB vía REST service-role local sin imprimir secretos:
   - `status=canceled`: PASS.
   - `cancel_reason` presente: PASS.
   - `canceled_at` presente: PASS.
5. Crear payment test:
   - `POST /api/billing/payments`: 201.
6. Leer payment:
   - `GET /api/billing/payments?invoiceId=...`: 200.
   - Count observado: 1.
7. Confirmar balance:
   - `GET /api/billing/customers/:customerId/balance`: 200.
   - Contrato estable con `currentBalance`, `overdueBalance`, `totalBalance`, `pendingInvoices`, `overdueInvoices`, `lastPaymentAmount`, `lastPaymentDate`.

## RBAC Billing

Validado con JWT real en staging para writes:

Permitidos:

- Super Admin: `POST /api/billing/run-cycle` 200.
- Administrador: `POST /api/billing/run-cycle` 200.
- Cobranza: `POST /api/billing/run-cycle` 200.
- Cobranza: `POST /api/billing/invoices` 201.
- Administrador: `POST /api/billing/invoices/:id/cancel` 200.
- Cobranza: `POST /api/billing/payments` 201.

Bloqueados con 403:

- Técnico:
  - `POST /api/billing/invoices`.
  - `POST /api/billing/invoices/:id/cancel`.
  - `POST /api/billing/payments`.
  - `POST /api/billing/run-cycle`.
- Soporte:
  - mismos endpoints write.
- Solo lectura:
  - mismos endpoints write.

Lectura:

- Validada por contrato en store/default para todos los roles.
- Validada en staging con JWT real para Super Admin en endpoints principales.

## Customer 360 Billing

Validación de UI por contrato/source y build:

Sección Cobranza presente en Cliente 360:

- Saldo actual.
- Saldo vencido.
- Facturas pendientes.
- Facturas vencidas.
- Último pago.
- Fecha último pago.
- Acciones:
  - Ver facturas.
  - Registrar pago.
  - Ver estado de cuenta.

Autenticación frontend:

- Uso de `Authorization: Bearer <JWT>` configurado en `App.tsx` y `apiClient`.
- Comentario/contrato específico de `CrmModule` indica lectura de balance vía Bearer JWT.
- No se validó con login visual completo en navegador por manejo conservador de secretos de staging, pero sí con JWT real desde API y con contratos de UI/source.

## Dashboard Billing

Validación de UI por contrato/source y build:

Sección Cobranza Ejecutiva presente:

- Facturación del mes.
- Cobrado del mes.
- Pendiente de cobro.
- Clientes con adeudo.
- Facturas vencidas.
- Top 10 adeudos.

Endpoint validado:

- `GET /api/dashboard/billing-kpis`: 200.
- Contrato estable.
- Sin secretos en payload.

## Seguridad

Logs recientes del contenedor revisados por patrones, sin imprimir contenido sensible.

Ausencia confirmada de:

- JWT.
- Service role.
- Passwords.
- Private keys.
- Preshared keys.
- Credentials.
- Tokens.
- Scripts RouterOS write.

Payloads billing revisados por patrones sensibles: PASS.

## No impacto RouterOS / MikroTik

Confirmado:

- `USE_DB_MIKROTIK`: UNSET.
- `USE_DB_WIREGUARD`: UNSET.
- `MIKROTIK_WORKER_LIVE`: OFF.
- `MIKROTIK_COMMIT_MODE`: UNSET.
- `MIKROTIK_WRITE_ENABLED`: UNSET.
- No RouterOS Write.
- No Worker Live.
- No suspensión real.
- No reactivación real.
- No comandos MikroTik.
- No cambios en routers.

Escaneo de `backend/domains/billing/**` sin coincidencias de:

- `/api/routeros`.
- `/api/mikrotik`.
- flags MikroTik/RouterOS write.
- comandos RouterOS write prohibidos.

Escaneo de UI billing relacionada sin integración Stripe/MercadoPago y sin llamadas RouterOS.

## Limitaciones / blocker

Blocker para aprobación total:

- El comando global pedido `RUN_DB_TESTS=true npm run test:db` no pasó completo por suites no Billing.
- Como no se autorizaron migraciones, no se corrigió el problema de inventario DB.
- Por instrucción, no se creó commit documental porque no todo pasó.

## Veredicto

⚠️ NO APROBADA TODAVÍA por gate global `test:db` fallido.

La base Billing & Collections específica sí queda funcional en staging, con persistencia DB validada, RBAC validado, Customer 360/Dashboard Billing presentes y sin impacto RouterOS.

No avanzar a Stripe/MercadoPago.
No avanzar a suspensión real.
No tocar routers reales.
