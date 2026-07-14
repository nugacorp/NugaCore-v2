# Payment Engine + Reactivación Automática — Validación Staging Fase 4.8

Fecha inicial: 2026-06-12
Revalidación final: 2026-06-13

Commits validados:

- `f5a97f1 feat(payments): add Payment Engine and logical reactivation (Fase 4.8)`
- `5830b3e fix(payments): align payment engine with persistent customers and billing`
- `cdcf0cb fix(payments): normalize UI write permissions by role`

Resultado final: **APROBADO**

## Alcance y restricciones

Validación ejecutada en staging sin activar commit mode y sin tocar routers reales.

Restricciones mantenidas:

- No se activó commit mode.
- No se ejecutó PPP real.
- No se ejecutó Queue real.
- No se ejecutaron comandos MikroTik/RouterOS reales.
- No se cambió configuración real de red.
- No se documentaron secretos, tokens, JWTs, claves privadas ni payloads sensibles.

## 1. Actualización de staging

Repositorio: `/opt/nugacore-staging`

Comandos ejecutados:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Log confirmado:

```text
cdcf0cb fix(payments): normalize UI write permissions by role
5830b3e fix(payments): align payment engine with persistent customers and billing
9834113 docs(payments): validate payment engine staging
f5a97f1 feat(payments): add Payment Engine and logical reactivation (Fase 4.8)
c6a3b5a docs(router-enrollment): approve WireGuard auto enrollment
031bd1f fix(router-enrollment): remove secret key names from script preview
50c4df1 docs(router-enrollment): validate WireGuard auto enrollment final approval
1a38180 docs(roadmap): register Fase 4.8 Payment Engine and update architecture docs
65c1359 fix(router-enrollment): use default WireGuard server and complete start contract
6bc9ad4 docs(router-enrollment): validate WireGuard auto enrollment staging
```

## 2. Redeploy Coolify y healthchecks

Redeploy Coolify ejecutado sobre:

```text
cdcf0cb9052650ecc2c8c4b3ac531aae028af905
```

Resultado Coolify:

```text
deployment_uuid=ee7qw2adia1q53gp1bs0gb76
status=finished
commit=cdcf0cb9052650ecc2c8c4b3ac531aae028af905
```

Contenedor activo post-deploy:

```text
zmjc5lnl0wj3kh0uj14s2p4i:cdcf0cb9052650ecc2c8c4b3ac531aae028af905 — healthy
```

Healthchecks post-deploy y post-limpieza:

| Endpoint | Resultado |
|---|---:|
| `/api/health` | 200 |
| `/api/health/live` | 200 |
| `/api/health/ready` | 200 |

## 3. Tests locales

Comandos ejecutados:

```bash
npm run typecheck
npm test
npm run build
```

Resultado:

| Gate | Resultado |
|---|---|
| TypeScript | PASS |
| Tests | PASS — 635 passed, 34 skipped, 48 files |
| Build | PASS |

Build generó `dist/` correctamente. Solo apareció el warning normal de chunk grande de Vite.

## 4. Fix UI RBAC validado

Commit de cierre:

```text
cdcf0cb fix(payments): normalize UI write permissions by role
```

Cambio validado:

- Nuevo helper `src/lib/paymentsRbac.ts`.
- `PaymentsModule.tsx` usa `canWritePayments()`.
- Comparación case-insensitive.
- Roles con escritura: Super Admin, Administrador, Cobranza.
- Roles sin escritura: Técnico, Soporte, Solo lectura.

Tests unitarios nuevos validados:

```text
tests/unit/payments.rbac.test.ts — 17 tests PASS
```

## 5. Validación UI — Super Admin

Login real Supabase desde formulario web con usuario temporal Super Admin.

Resultado observado en `Portal Pagos & Reactivación`:

| Validación | Resultado |
|---|---|
| Login real | PASS |
| Módulo visible | PASS |
| Pestañas `Órdenes` / `Acciones MikroTik` visibles | PASS |
| Botón `Nueva Orden` visible | PASS |
| Bloque `Reactivación Lógica Manual` visible | PASS |

## 6. Validación UI — Administrador

Login real Supabase desde formulario web con usuario temporal Administrador.

Resultado observado en `Portal Pagos & Reactivación`:

| Validación | Resultado |
|---|---|
| Login real | PASS |
| Módulo visible | PASS |
| Pestañas `Órdenes` / `Acciones MikroTik` visibles | PASS |
| Botón `Nueva Orden` visible | PASS |
| Bloque `Reactivación Lógica Manual` visible | PASS |

## 7. Validación UI — Cobranza

Login real Supabase desde formulario web con usuario temporal Cobranza.

Resultado observado en `Portal Pagos & Reactivación`:

| Validación | Resultado |
|---|---|
| Login real | PASS |
| Módulo visible | PASS |
| Pestañas `Órdenes` / `Acciones MikroTik` visibles | PASS |
| Botón `Nueva Orden` visible | PASS |
| Bloque `Reactivación Lógica Manual` visible | PASS |

## 8. Validación UI — roles sin escritura

Login real Supabase desde formulario web con usuarios temporales Técnico, Soporte y Solo lectura.

Resultado observado:

| Rol | Login real | Módulo pagos | `Nueva Orden` | `Reactivación Lógica Manual` |
|---|---:|---:|---:|---:|
| Técnico | PASS | Oculto por RBAC de navegación | No visible | No visible |
| Soporte | PASS | Oculto por RBAC de navegación | No visible | No visible |
| Solo lectura | PASS | Oculto por RBAC de navegación | No visible | No visible |

El comportamiento es aceptable para roles sin escritura: no tienen controles de escritura visibles. Además, los endpoints de escritura siguen protegidos por backend:

| Rol | `POST /api/payments/orders` | `POST /api/payments/customers/:id/reactivate` |
|---|---:|---:|
| Técnico | 403 | 403 |
| Soporte | 403 | 403 |
| Solo lectura | 403 | 403 |

## 9. Regresión backend rápida

Se ejecutó un probe de regresión con clientes/facturas DB de prueba y usuarios temporales. No se imprimieron JWTs ni contraseñas.

Resultados:

| Validación | Resultado |
|---|---|
| `amount` en pesos | PASS — `POST /api/payments/orders` -> 201, `amountPesos=299` |
| `amountCents` | PASS — `POST /api/payments/orders` -> 201, `amountPesos=299` |
| `AMOUNT_MISMATCH` | PASS — HTTP 400, `code=AMOUNT_MISMATCH` |
| `INVOICE_CLIENT_MISMATCH` | PASS — HTTP 400, `code=INVOICE_CLIENT_MISMATCH` |
| Webhook manual primer envío | PASS — HTTP 200, `invoiceUpdated=true`, `reactivationTriggered=true` |
| Webhook manual segundo envío | PASS — HTTP 200, `idempotent=true`, sin duplicados |
| Factura post-webhook | PASS — `status=paid`, `paidAmount=299`, `pendingAmount=0`, un pago |
| Reactivación lógica | PASS — `dryRun=true`, una acción lógica |
| `MIKROTIK_WORKER_LIVE` | PASS — `false` |

## 10. Reactivación lógica y no MikroTik real

Validaciones finales:

```text
MIKROTIK_WORKER_LIVE=false
allActionsDryRun=true
routeros_live_commands=false
```

No se ejecutaron comandos PPP, Queue, address-list ni RouterOS reales. La reactivación validada fue lógica y creó acciones con `dryRun=true` únicamente.

## 11. Secret hygiene

Se revisaron logs recientes con búsqueda de patrones, sin imprimir valores sensibles.

Resultado:

```text
provider_tokens=false
rawPayload_sensitive=false
supabase_service_role=false
jwt=false
mikrotik_credentials_key_value=false
private_keys=false
routeros_scripts_or_live_commands=false
```

La API pública de pagos no expuso `rawPayload` ni secretos.

## 12. Limpieza

Acciones ejecutadas:

- Clientes DB de prueba eliminados.
- Facturas DB de prueba eliminadas.
- Payments/payment_applications asociados eliminados.
- Usuarios temporales Supabase eliminados.
- Contenedor staging reiniciado para limpiar `payment_orders`, `payment_events` y `mikrotik_actions` en memoria.

Verificación post-limpieza:

```text
remainingTestClients=0
remainingTestInvoices=0
remainingTempProfiles=0
/api/health=200
/api/health/live=200
/api/health/ready=200
contenedor=healthy
MIKROTIK_WORKER_LIVE=false
```

## 13. Resultado final

**Fase 4.8 APROBADA.**

La validación final confirma:

- Payment order funciona con `amount` y `amountCents`.
- Mismatches de monto y factura/cliente son rechazados correctamente.
- Webhook manual confirma pago, marca factura pagada y es idempotente.
- Reactivación lógica funciona sobre DB y conserva `dryRun=true`.
- UI RBAC del Portal Pagos funciona para Super Admin, Administrador y Cobranza.
- Técnico, Soporte y Solo lectura no ven controles de escritura y backend devuelve 403.
- No hubo exposición de secretos.
- No se tocó MikroTik real.
