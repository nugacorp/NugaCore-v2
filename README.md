# NugaCore

Plataforma **SaaS multi-tenant de operación para WISP/ISP** (inalámbrico y FTTH): un WISP por tenant, con CRM, planes, facturación, cobranza, pagos, suspensión/reactivación, soporte, inventario, red (MikroTik/RouterOS, WireGuard, OLT/FTTH, GIS, NOC/SNMP), portal de clientes, PWA de técnicos y reportes.

React + Vite + TypeScript en el frontend, Express + TypeScript en el backend, PostgreSQL vía Supabase. Los fixtures de base de datos real en CI se ejecutan sobre PostgreSQL 17; la versión del servicio remoto de Supabase no se afirma aquí porque este repositorio no la consulta.

## Cómo leer el estado del proyecto

Este repositorio distingue de forma deliberada **implementado** de **validado en un ambiente real**. Casi todo lo que existe está implementado y cubierto por pruebas herméticas; una parte menor está además validada contra infraestructura externa, y eso se declara caso por caso.

- Estado actual y blockers priorizados: [docs/reports/PROJECT_STATUS_CURRENT.md](./docs/reports/PROJECT_STATUS_CURRENT.md) — **fuente de verdad**.
- Roadmap maestro: [ROADMAP.md](ROADMAP.md)
- Plan de puesta en producción: [docs/PRODUCTION_LIVE_MASTER_PLAN.md](./docs/PRODUCTION_LIVE_MASTER_PLAN.md)
- Arquitectura: [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)
- Checklist de producción: [docs/deployment/PRODUCTION_READINESS_CHECKLIST.md](./docs/deployment/PRODUCTION_READINESS_CHECKLIST.md)
- Reactivación automática por pago (Spec 001): [docs/operations/automatic-payment-reactivation.md](./docs/operations/automatic-payment-reactivation.md)
- Publicación de versiones: [docs/operations/RELEASING.md](./docs/operations/RELEASING.md)

Los documentos bajo [`docs/results/`](./docs/results/) son **evidencia histórica** fechada de validaciones concretas. No describen el estado de hoy; consérvalos como registro, no como estado actual.

## Arquitectura

Un solo proceso Node en el puerto 3000 sirve la SPA de React y la API Express bajo `/api/*`. No hay servidor de frontend separado.

```text
Navegador (SPA React)
   │  fetch → /api/*   (JWT Supabase; trusted-headers sólo en dev)
   ▼
Express — helmet · CORS · rate-limit · auth/RBAC · tenant fail-closed
   │
   ├─ backend/domains/<dominio>/{routes,service,repository}.ts
   │     repository dual conmutado por USE_DB_<DOMINIO>:
   │        false → store en memoria   |   true → Supabase
   │
   ├─ backend/bridges/network-order-dispatch.ts   (única frontera hacia la red)
   └─ backend/domains/mikrotik/worker/            (lectura allowlisted / escritura gated)
   ▼
Supabase / PostgreSQL
```

### Persistencia dual

Los dominios núcleo soportados —clientes, planes, facturación, pagos, suspensión, inventario, soporte, tenancy, contratos, portal, OLT, WireGuard, router-enrollment— usan el patrón dual: store en memoria o Supabase, según su flag `USE_DB_*` ([backend/config/feature-flags.ts](./backend/config/feature-flags.ts)). En ellos, la misma API y las mismas pruebas de contrato deben pasar en ambos modos.

El patrón **no es universal**. Varios dominios siguen exclusivamente en memoria y no tienen repositorio Supabase, en algunos casos pese a que sus tablas ya existen en migraciones. La lista vigente está en [docs/reports/PROJECT_STATUS_CURRENT.md](./docs/reports/PROJECT_STATUS_CURRENT.md).

El modo de desarrollo por defecto es **hermético**: todos los flags en `false`, sin red ni secretos.

### build-once / deploy-many

La imagen OCI no se construye por ambiente. La configuración pública de Supabase (URL y anon key) se entrega en runtime desde `/runtime-config.js`, no incrustada en el bundle, así que el mismo digest validado en un ambiente puede promoverse a otro cambiando sólo variables del contenedor. Sólo esos dos valores llegan al navegador: el endpoint usa una allowlist explícita y nunca recorre el entorno. Ver [docs/operations/RELEASING.md](./docs/operations/RELEASING.md).

### Gates de ejecución real

Todo subsistema con efecto externo está **apagado por defecto** ([backend/config/production-gates.ts](./backend/config/production-gates.ts)): `MIKROTIK_WORKER_LIVE`, `MIKROTIK_WORKER_COMMIT`, `PAYMENTS_ROUTER_LIVE`, `NOTIFICATIONS_LIVE`, `AUTOMATION_EXECUTE`, `PROVISIONING_EXECUTE`, `SAFE_COMMAND_QUEUE_LIVE`, `SERVICE_STATUS_LIVE`, con `NUGACORE_LIVE_MODE` como interruptor maestro. Encenderlos es una decisión operativa explícita, no un efecto colateral de desplegar.

## Estado

### Implementado y cubierto por pruebas en CI

- Multi-tenancy con resolución de tenant fail-closed y aislamiento por repositorio.
- CRM, planes, facturación (fuente canónica del dinero), cobranza y pagos.
- Motor de suspensión/reactivación, incluida la **reactivación automática tras pago confirmado (Spec 001 / B1)**: el motor emite el bloqueo financiero estructurado, el worker no puede cortar sin esa evidencia persistida, y la limpieza tras el pago es idempotente.
- Integración MikroTik/RouterOS: lectura con allowlist estricta, escritura acotada a tres familias de comandos y doble gate.
- WireGuard, OLT/FTTH, GIS, NOC/SNMP, inventario, tickets, contratos con firma, portal de clientes y PWA de técnicos.
- Gates de base de datos real en CI sobre PostgreSQL 17: idempotencia de webhooks, borrado de clientes, reconstrucción del esquema desde cero, persistencia del portal, firma de contratos y `customer_suspension_blocks`.
- Guarda de nombres de migración: dos archivos con el mismo prefijo de versión hacen fallar CI antes de las pruebas (`npm run validate:migration-files`).

### Implementado pero NO validado contra infraestructura externa

- Proveedores de pago (Mercado Pago, OpenPay, SPEI, CoDi): sin evidencia de sandbox real.
- RouterOS: la lectura/read-only y el dry-run tienen evidencia histórica en un CHR de laboratorio (`docs/results/MIKROTIK_WORKER_LIVE_CHR_STAGING_RESULT.md`, 2026-06-05, sobre un commit anterior; no es una validación del HEAD actual). **La escritura RouterOS no ha sido validada en CHR ni contra hardware.**
- Paridad del esquema en staging para las migraciones más recientes.
- Readiness estricto de producción y evidencia de restore.

### No iniciado

- Integración UISP/Splynx.

No se declara ningún porcentaje de avance: el estado útil es la tabla de blockers del informe de estado.

## Instalación

```bash
npm install
```

## Entorno

```bash
cp .env.example .env
```

Los valores por defecto de `.env.example` sirven para desarrollo hermético. Supabase, Gemini y MikroTik son opcionales: sin credenciales, el sistema usa store en memoria y modo simulado.

Para producción, parte de [`.env.production.example`](./.env.production.example) y de [docs/deployment/PRODUCTION_RUNTIME_ENV_CHECKS.md](./docs/deployment/PRODUCTION_RUNTIME_ENV_CHECKS.md). En runtime endurecido (`NODE_ENV=production` o `PUBLIC_DEPLOYMENT=true`) el proceso hace fail-fast si `AUTH_TRUST_HEADERS=true`, si falta `MIKROTIK_CREDENTIALS_KEY` o si faltan las credenciales de Supabase.

## Desarrollo

```bash
npm run dev          # build + sirve el bundle estático en :3000
SERVE_MODE=dev npm run dev:tsx   # servidor Vite real con HMR
```

## Calidad

```bash
npm run validate:migration-files   # nombres y versiones únicas de migración (hermético)
npm run lint                       # eslint + typecheck (frontend y backend)
npm test                           # suite hermética completa
npm run build                      # bundle de producción
npm audit --omit=dev               # dependencias de runtime
```

`npm test` es hermético: sin red ni secretos. Las suites `test:db`, `test:db:billing` y `test:auth` requieren una Supabase real y **se omiten** cuando no está configurada; esas omisiones no son fallos.

Los fixtures de PostgreSQL 17 (`npm run test:db:postgres17 -- <caso>`) levantan un contenedor desechable y validan lo que el modo mock no puede afirmar: RLS, ACL mínima, índices únicos y carreras reales.

## Migraciones

Las migraciones viven en [`supabase/migrations/`](./supabase/migrations/) y se aplican **por `psql` contra el pooler**, nunca con `supabase db push`.

El contrato de nombres es `YYYYMMDDHHMMSS_descripcion.sql` con versión única. No es una preferencia de estilo: el historial de Supabase registra una sola fila por versión, así que dos archivos con el mismo prefijo dejan a uno sin aplicarse para siempre. Ocurrió con `20260717040000` y `20260717050000`; ambas colisiones están normalizadas y reaplicadas, y el validador de CI impide que se repitan. Ver [docs/deployment/SUPABASE_MIGRATIONS_SYNC.md](./docs/deployment/SUPABASE_MIGRATIONS_SYNC.md).

## Guardrails

- No aplicar migraciones, ejecutar RouterOS live ni provisionar de verdad sin autorización explícita.
- No commitear secretos, tokens, JWTs, contraseñas ni identificadores privados de despliegue.
- No presentar resultados históricos ni salidas de mocks como validación actual.
- Antes de validar en staging, confirmar que el commit está en `origin/main`.

Instrucciones completas para agentes: [AGENTS.md](AGENTS.md).
