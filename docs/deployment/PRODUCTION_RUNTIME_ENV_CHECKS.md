# Production Runtime And Env Checks

Esta checklist complementa `.env.production.example` y los gates:

```bash
npm run validate-production-readiness
npm run validate-production-readiness:strict
npm run validate-restore-checklist:strict
```

## Runtime Minimo

- `NODE_ENV=production`.
- `PUBLIC_DEPLOYMENT=true` si el servicio es accesible desde internet.
- `AUTH_TRUST_HEADERS=false`.
- HTTPS/TLS terminado en proxy o plataforma aprobada.
- `CORS_ALLOWED_ORIGINS` limitado al dominio real.
- `RATE_LIMIT_ENABLED=true`.
- `CSP_ENABLED=true`.
- Healthcheck en `/api/health/live`.
- Readiness en `/api/health/ready`.
- Logs en formato JSON y sin secretos.
- Secrets inyectados desde Coolify/gestor seguro, no desde archivos commiteados.

## Persistencia Critica

Los dominios WISP core deben quedar en DB real antes de aprobar strict:

```env
USE_DB_CUSTOMERS=true
USE_DB_PLANS=true
USE_DB_BILLING=true
USE_DB_PAYMENTS=true
USE_DB_INVENTORY=true
USE_DB_SUPPORT=true
USE_DB_SUSPENSION=true
```

`USE_DB_MIKROTIK` permanece apagado salvo aprobacion especifica para el dominio
MikroTik DB runtime. Router Enrollment y WireGuard pueden activarse si sus
migraciones ya estan aplicadas y validadas.

## Webhooks

Variables esperadas por el codigo:

```env
WEBHOOK_SECRET_MANUAL=__SECRET__
WEBHOOK_SECRET_MERCADO_PAGO=__SECRET__
WEBHOOK_SECRET_OPENPAY=__SECRET__
```

No usar `WEBHOOK_SECRET_MERCADOPAGO`; ese nombre no es leido por el proveedor
MercadoPago actual. En runtime endurecido, un webhook publico sin secreto debe
fallar cerrado.

## OpenPay Sandbox/Fallback

Las credenciales por WISP viven en `wisp_integration_settings` cifradas. Las
variables de entorno son fallback single-WISP:

```env
OPENPAY_MERCHANT_ID=__SECRET__
OPENPAY_PRIVATE_KEY=__SECRET__
OPENPAY_SANDBOX=true
WEBHOOK_SECRET_OPENPAY=__SECRET__
```

Antes de produccion real debe existir una validacion sandbox con firma,
idempotencia, pago parcial, pago total y reconciliacion de fallos.

## Comandos Que No Deben Imprimir Secretos

- Usar `npm run docker:config:safe` para revisar Compose.
- No publicar salidas de `docker compose config` sin `--no-interpolate`.
- No imprimir `.env`, JWT, service-role keys, passwords RouterOS ni HMAC keys.
- Si se necesita demostrar presencia de un secreto, reportar solo `SET/UNSET` o
  fingerprint no reversible.
