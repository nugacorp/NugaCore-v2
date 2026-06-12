# Payment Engine + Reactivación Automática — Validación Staging Fase 4.8

Fecha: 2026-06-12
Commit validado: `f5a97f1 feat(payments): add Payment Engine and logical reactivation (Fase 4.8)`
Deployment Coolify: `m7h2snc4ypkszoh1tp1jei40`
Resultado final: **NO APROBADO**

## Alcance y restricciones

Validación ejecutada en staging sin activar commit mode y sin tocar routers reales.

Restricciones mantenidas:

- No se activó commit mode.
- No se ejecutó PPP.
- No se ejecutó Queue.
- No se ejecutaron comandos MikroTik.
- No se cambió configuración de red.
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

Resultado:

```text
f5a97f1 feat(payments): add Payment Engine and logical reactivation (Fase 4.8)
c6a3b5a docs(router-enrollment): approve WireGuard auto enrollment
031bd1f fix(router-enrollment): remove secret key names from script preview
50c4df1 docs(router-enrollment): validate WireGuard auto enrollment final approval
1a38180 docs(roadmap): register Fase 4.8 Payment Engine and update architecture docs
65c1359 fix(router-enrollment): use default WireGuard server and complete start contract
6bc9ad4 docs(router-enrollment): validate WireGuard auto enrollment staging
b683867 fix(router-enrollment): prevent orphan routers and preserve routeros version
84f6439 feat(router-enrollment): add WireGuard auto enrollment workflow
4d5e648 docs(routeros): approve templates library phase 4.6.3
```

## 2. Redeploy Coolify y healthchecks

Redeploy Coolify ejecutado sobre el commit completo:

```text
f5a97f19a1441ba36cc91e847a400591645b69e0
```

Resultado Coolify:

```text
deployment_uuid=m7h2snc4ypkszoh1tp1jei40
status=finished
commit=f5a97f19a1441ba36cc91e847a400591645b69e0
```

Contenedor activo:

```text
zmjc5lnl0wj3kh0uj14s2p4i:f5a97f19a1441ba36cc91e847a400591645b69e0 — healthy
```

Healthchecks post-deploy y post-limpieza:

| Endpoint | Resultado |
|---|---:|
| `/api/health` | 200 |
| `/api/health/live` | 200 |
| `/api/health/ready` | 200 |

`/api/health` reportó persistencia `mixed` con dominios DB:

```text
customers, plans, billing
```

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
| Tests | PASS — 611 passed, 34 skipped, 47 files |
| Build | PASS |

Build generó `dist/` correctamente. Solo apareció el warning normal de chunk grande de Vite.

## 4. RBAC real validado en staging

Se crearon usuarios temporales Supabase por rol, se autenticaron por JWT y se eliminaron al finalizar. No se imprimieron JWTs ni contraseñas.

Endpoints validados:

- `GET /api/payments/orders`
- `POST /api/payments/orders`
- `GET /api/payments/actions`
- `POST /api/payments/customers/:id/reactivate`

Matriz real observada:

| Rol | GET orders | POST orders | GET actions | POST reactivate |
|---|---:|---:|---:|---:|
| Super Admin | 200 | 201 | 200 | 200 |
| Administrador | 200 | 201 | 200 | 200 |
| Cobranza | 200 | 201 | 200 | 200 |
| Técnico | 200 | 403 | 200 | 403 |
| Soporte | 200 | 403 | 200 | 403 |
| Solo lectura | 200 | 403 | 200 | 403 |

Comparación contra tests:

- Coincide con `WRITE_ROLES = ['super admin', 'administrador', 'cobranza']`.
- Coincide con `READ_ROLES` amplio: técnico, soporte y solo lectura pueden leer órdenes/acciones.
- Los tests cubren explícitamente reader 403 en creación/reactivación; staging confirmó además técnico y soporte con 403 en escritura.

## 5. Fixture de factura de prueba

Se intentó validar con fixture staging no real. El entorno actual tiene `customers` y `billing` en DB, pero `payments` permanece en store en memoria.

Resultado observado:

- `GET /api/clients/c-4` devolvió 404 porque `customers` está en DB y `c-4` existe solo en el store mock del backend.
- `POST /api/suspension/test-tools/scenario` creó un cliente/factura de prueba en DB.
- Factura creada: `fac-101`.
- Cliente de prueba DB: `c-2`.
- Factura antes del pago:
  - `status=overdue`
  - `amount=299`
  - `paidAmount=0`
  - `pendingAmount=299`

Problema de integración encontrado:

- La reactivación del Payment Engine usa `store.CLIENTS` directamente, no el servicio/repository de Customers.
- Por eso no puede reactivar clientes creados en DB por test-tools.
- Para ejercer la rama de reactivación lógica, la orden se creó con `customerId=c-4` (cliente mock en memoria) y `invoiceId=fac-101` (factura DB del cliente test `c-2`).
- Esto demuestra que el flujo técnico puede marcar la factura pagada y crear `mikrotik_action`, pero no valida correctamente la relación real `customerId == invoice.clientId` en staging DB.

Este punto bloquea aprobación porque el requisito pedía usar cliente/factura de staging test, no cliente mock/seed desacoplado.

## 6. Payment order

Endpoint:

```http
POST /api/payments/orders
```

Body sugerido por la solicitud:

```json
{
  "customerId": "<customerId>",
  "invoiceId": "<invoiceId>",
  "provider": "manual",
  "amount": 299
}
```

Resultado real con `amount`: **400**.

El endpoint implementado exige `amountCents`, no `amount`:

```json
{
  "customerId": "c-4",
  "invoiceId": "fac-101",
  "provider": "manual",
  "amountCents": 29900
}
```

Resultado con `amountCents`: **201**.

Respuesta observada:

```text
id=po-4
provider=manual
providerOrderId=manual-po-4
status=pending
amountPesos=299
invoiceId=fac-101
customerId=c-4
checkoutUrl=null/no presente, aceptable para manual
```

## 7. Webhook manual

Endpoint:

```http
POST /api/payments/webhook/manual
```

Payload controlado usado:

```text
id=evt-phase48-1781304546686-93c6bc9d72fc4
type=payment.approved
order_id=manual-po-4
status=approved
amount=299
invoiceId=fac-101
```

Resultado primer envío:

```text
HTTP 200
eventId=pe-1
idempotent=false
invoiceUpdated=true
reactivationTriggered=true
mikrotikActionId=ma-1
message=Pago confirmado, factura actualizada y reactivación programada.
```

Factura después del webhook:

```text
invoiceId=fac-101
status=paid
amount=299
paidAmount=299
pendingAmount=0
paymentCountOnInvoice=1
```

## 8. Idempotencia del webhook

Se envió el mismo webhook manual por segunda vez.

Resultado:

```text
HTTP 200
eventId=pe-1
idempotent=true
invoiceUpdated=false
reactivationTriggered=false
message=Evento ya procesado anteriormente.
```

Validaciones:

- No se duplicó el evento procesado para el mismo provider event id.
- No se duplicó el payment en la factura observada.
- La factura permaneció `paid` con `pendingAmount=0`.
- No se creó una segunda acción de reactivación para el mismo flujo observado.
- La respuesta fue controlada.

## 9. Reactivación lógica

Para el cliente mock suspendido `c-4`, el pago confirmado generó una acción lógica:

```text
id=ma-1
customerId=c-4
actionType=reactivate
status=pending
dryRun=true
```

Validación de cliente ya activo:

```text
POST /api/payments/customers/c-1/reactivate -> 200
alreadyActive=true
mikrotikAction=null
message=Cliente ya activo.
```

Problema de diseño observado:

- `reactivateCustomerService()` no usa `CustomersService` ni DB cuando `USE_DB_CUSTOMERS=true`.
- Busca el cliente en `store.CLIENTS`.
- En staging actual, los clientes reales/test de DB no son reactivables por Payment Engine si no existen también en el store mock.

## 10. Payment providers

Providers validados en modo mock/stub:

| Provider | createPaymentOrder | webhook/verifyWebhook | Resultado |
|---|---:|---:|---|
| manual | 201 | 200 | PASS |
| mercado_pago | 201 | 200 | PASS |
| openpay | 201 | 200 | PASS |

No se usaron credenciales reales de provider.

Por revisión de implementación, los providers exponen `createPaymentOrder`, `verifyWebhook` y `getPaymentStatus`.

## 11. Payment events

No hay endpoint público directo para listar `payment_events`.

Validación por respuesta controlada del webhook:

```text
provider=manual
provider_event_id=evt-phase48-1781304546686-93c6bc9d72fc4
event_type=payment.approved
processed=true
received_at presente de forma interna por eventId generado
payload no expuesto por endpoint público
```

La API pública de orders/actions no expuso `rawPayload`.

## 12. Portal Pagos UI

Validación parcial:

- El bundle desplegado contiene el módulo `PaymentsModule` y la navegación incluye el módulo Pagos para roles con permiso según el código desplegado.
- API backend para el módulo respondió correctamente según la matriz RBAC real.
- No se observaron campos `rawPayload`, tokens o secretos en respuestas públicas de orders/actions.

Bloqueo UI observado:

- Se crearon usuarios temporales Supabase para prueba de UI y se confirmó sign-in exitoso desde Node dentro del contenedor.
- El formulario web respondió `Invalid login credentials` para esos mismos usuarios temporales desde el navegador.
- Por este bloqueo de autenticación del navegador no se pudo completar una validación visual end-to-end del módulo Pagos en UI con rol permitido/no permitido.

Esto también impide aprobación completa de la Fase 4.8 desde la perspectiva de portal.

## 13. Secret hygiene

Se revisaron logs recientes con búsqueda por patrones, sin imprimir valores sensibles.

Resultado de patrones en logs recientes:

```text
provider_tokens=false
rawPayload_sensitive=false
supabase_service_role=false
jwt=false
mikrotik_credentials_key=false
private_keys=false
routeros_scripts=false
```

No se documentaron secretos.

## 14. No MikroTik real

Validaciones:

```text
MIKROTIK_WORKER_LIVE=false
allActionsDryRun=true
anyActionDryRunFalse=false
```

No se ejecutaron comandos RouterOS reales, PPP, Queue ni cambios de red.

El contenedor fue reiniciado después del probe para limpiar artefactos en memoria del Payment Engine (`payment_orders`, `payment_events`, `mikrotik_actions`).

## 15. Limpieza

Acciones ejecutadas:

- Cliente/factura de prueba creada por test-tools eliminada con `DELETE /api/suspension/test-tools/customer/:id`.
- Usuarios temporales Supabase eliminados.
- Contenedor staging reiniciado para limpiar artefactos en memoria de Payment Engine.
- Healthchecks post-limpieza siguieron en 200.

Resultado post-limpieza:

```text
/api/health -> 200
/api/health/live -> 200
/api/health/ready -> 200
contenedor healthy
MIKROTIK_WORKER_LIVE=false
```

## 16. Resultado final

**Fase 4.8 NO APROBADA.**

Motivos bloqueantes:

1. `POST /api/payments/orders` no acepta el body sugerido con `amount`; exige `amountCents`. Esto debe documentarse/corregirse para evitar integración rota con clientes que envíen pesos.
2. En staging DB (`USE_DB_CUSTOMERS=true`, `USE_DB_BILLING=true`), Payment Engine mantiene pagos/actions en memoria y `reactivateCustomerService()` consulta `store.CLIENTS`. Esto no permite reactivar clientes test reales de DB y permitió validar la reactivación solo con un cliente mock desacoplado de la factura DB.
3. La validación UI end-to-end del módulo Pagos no pudo completarse porque el navegador devolvió `Invalid login credentials` para usuarios temporales que sí autenticaron desde Node contra Supabase.

Acciones recomendadas:

- Hacer que Payment Engine valide que `payment_order.customerId` coincide con `invoice.clientId` antes de procesar el webhook.
- Implementar reactivación contra `CustomersService`/repository, respetando `USE_DB_CUSTOMERS=true`, en lugar de acceder directo a `store.CLIENTS`.
- Decidir contrato de monto: aceptar `amount` en pesos y/o mantener `amountCents`, pero actualizar API/UI/tests/docs de forma consistente.
- Añadir endpoint administrativo seguro o test-tool para inspeccionar `payment_events` sin exponer payload sensible.
- Corregir/diagnosticar login web de usuarios temporales staging para poder completar validación visual del portal Pagos.
