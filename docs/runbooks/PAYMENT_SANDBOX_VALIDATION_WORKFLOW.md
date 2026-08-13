# Payment Sandbox Validation Workflow

Este runbook prepara la validacion real de pagos en sandbox antes de produccion.
No usar llaves productivas. No pegar tokens, payloads con PII ni firmas completas
en reportes.

## Proveedores Soportados

- Manual provider: util para control interno y pruebas logicas.
- MercadoPago: requiere `MP_ACCESS_TOKEN` sandbox y
  `WEBHOOK_SECRET_MERCADO_PAGO`.
- OpenPay: requiere `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY`,
  `OPENPAY_SANDBOX=true` y `WEBHOOK_SECRET_OPENPAY` o secretos por WISP en
  `wisp_integration_settings`.

## Variables Sandbox

```env
USE_DB_CUSTOMERS=true
USE_DB_BILLING=true
USE_DB_PAYMENTS=true
USE_DB_SUSPENSION=true

PUBLIC_DEPLOYMENT=true
NODE_ENV=production
AUTH_TRUST_HEADERS=false

MP_ACCESS_TOKEN=__SANDBOX_SECRET__
WEBHOOK_SECRET_MERCADO_PAGO=__SANDBOX_SECRET__

OPENPAY_MERCHANT_ID=__SANDBOX_SECRET__
OPENPAY_PRIVATE_KEY=__SANDBOX_SECRET__
OPENPAY_SANDBOX=true
WEBHOOK_SECRET_OPENPAY=__SANDBOX_SECRET__
```

Mantener `MIKROTIK_WORKER_COMMIT=false` salvo aprobacion separada. La validacion
de pagos puede crear ordenes de reactivacion logica o dry-run sin ejecutar
cambios reales en RouterOS.

## Webhook Sandbox

1. Exponer URL publica de staging/sandbox aprobada.
2. Configurar webhook en el dashboard sandbox del proveedor.
3. Usar la ruta correcta:
   - MercadoPago: `/api/payments/webhook/mercadopago`.
   - OpenPay default: `/api/payments/webhook/openpay`.
   - OpenPay por WISP: `/api/payments/webhook/openpay/<token>`.
4. Confirmar que el proveedor firma los eventos.
5. Confirmar que NugaCore rechaza payloads sin firma o con firma invalida.

## Matriz De Prueba

| Caso | Esperado |
|---|---|
| Firma valida | Webhook aceptado y evento procesado. |
| Firma invalida | HTTP 400, sin pago registrado. |
| Sin secreto en runtime endurecido | HTTP 503 fail-closed. |
| Payload no JSON | HTTP 415. |
| Evento duplicado | Idempotente, no duplica pagos ni acciones. |
| Entrega concurrente | Una entrega reclama el evento; la otra reintenta/queda segura. |
| Pago parcial | `paidAmount` aumenta y factura queda pendiente/partial. |
| Pago total | Factura queda `paid` y balance en cero. |
| Pago excedente | Excedente se maneja segun politica vigente, sin perder auditoria. |
| Reactivacion cliente | Se crea accion/orden de reactivacion con tenant correcto. |
| Cliente de otro tenant | Rechazado o no encontrado; no cruza datos. |
| Falla posterior al webhook | Evento queda reconciliable, sin estado parcial irreversible. |

## Flujo Operativo

1. Preparar datos QA.

   - Cliente QA en tenant de sandbox.
   - Factura QA vencida o suspendida.
   - Estado de servicio suspendido solo en sandbox.
   - Idempotency keys y prefijos QA identificables.

2. Crear orden de pago.

   - Crear orden por API/UI con provider sandbox.
   - Registrar `orderId`, `invoiceId`, `customerId` y tenant.
   - No registrar tokens ni payload completo.

3. Ejecutar pago parcial.

   - Pagar menos que el total.
   - Verificar factura parcial.
   - Verificar auditoria y evento idempotente.

4. Ejecutar pago total.

   - Pagar el saldo restante.
   - Verificar factura pagada.
   - Verificar accion/orden de reactivacion.
   - Confirmar que no se habilito RouterOS commit.

5. Probar duplicado.

   - Reenviar el mismo evento sandbox.
   - Confirmar que no se crea segundo pago.
   - Confirmar que el resultado idempotente es explicito.

6. Probar fallo de webhook.

   - Enviar firma invalida.
   - Enviar payload no JSON.
   - Enviar evento con tenant/token incorrecto.
   - Confirmar fail-closed y sin mutaciones indebidas.

7. Reconciliacion.

   - Comparar ordenes, pagos, factura, eventos y timeline.
   - Documentar diferencias con el dashboard sandbox del proveedor.
   - Resolver manualmente solo en sandbox y registrar causa.

## Evidencia Sanitizada

El reporte final debe incluir:

- Ambiente.
- Proveedor.
- Hora UTC.
- IDs internos QA.
- Resultado de cada caso de la matriz.
- HTTP status de webhooks, sin payload completo.
- Confirmacion de firma valida/invalida.
- Confirmacion de idempotencia.
- Confirmacion de tenant isolation.
- Confirmacion de que no se usaron llaves reales.

## Rollback/Cleanup

- Cancelar ordenes sandbox pendientes si el proveedor lo permite.
- Marcar o borrar datos QA solo mediante rutas/procesos aprobados de sandbox.
- Revertir cliente QA a estado esperado.
- Confirmar que no quedan eventos `in_progress` vencidos sin diagnostico.
- No borrar datos reales ni limpiar produccion.

## Criterios Para Avanzar

Antes de produccion real deben estar PASS:

- `npm run test:db:billing`
- `npm run test:db`
- Webhook sandbox firmado.
- Pago duplicado idempotente.
- Pago parcial.
- Pago total.
- Reactivacion logica.
- Tenant isolation.
- Auditoria.
- Reconciliacion o rollback documentado.

Si cualquiera falla, production strict debe seguir bloqueado.
