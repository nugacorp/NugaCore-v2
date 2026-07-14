# NugaCore — Feature Flags (fuente de verdad)

> Última actualización: 2026-06-24 (ARCH-1)
> Todas las flags se leen desde variables de entorno. Default seguro: `false`
> (store en memoria / sin integración live). Ninguna flag cambia comportamiento
> por sí sola sin la infraestructura correspondiente configurada.

## Ubicación central

`backend/config/feature-flags.ts` es la **única fuente de verdad** para las
flags de persistencia por dominio y para los flags independientes (WireGuard,
Router Enrollment). Helpers:

- `isDomainOnDb(domain)` — ¿el dominio lee/escribe contra DB en vez del store?
- `domainsOnDb()` — lista de dominios apuntando a DB (diagnóstico/health).
- `useDbRouterEnrollment()` — persistencia DB del enrollment.
- `useDbWireguard()` — persistencia DB del WireGuard Manager.

El servicio WireGuard (`backend/domains/wireguard/service.ts`) **delega** en
`useDbWireguard()` (ARCH-1): ya no relee `process.env` por su cuenta.

## Flags de persistencia por dominio (`USE_DB_<DOMINIO>`)

| Flag | Dominio | Default | Efecto cuando `true` |
| --- | --- | --- | --- |
| `USE_DB_CUSTOMERS` | customers | false | repository/DB |
| `USE_DB_PLANS` | plans | false | repository/DB |
| `USE_DB_BILLING` | billing | false | repository/DB (SSOT cobranza) |
| `USE_DB_SUSPENSION` | suspension | false | repository/DB |
| `USE_DB_NETWORK` | network | false | repository/DB |
| `USE_DB_FTTH` | ftth | false | repository/DB |
| `USE_DB_INVENTORY` | inventory | false | repository/DB |
| `USE_DB_SUPPORT` | support | false | tickets + work orders repository/DB |
| `USE_DB_COMMERCIAL` | commercial | false | CRM comercial (prospectos, cotizaciones, citas) |
| `USE_DB_PURCHASES` | purchases | false | proveedores + órdenes de compra |
| `USE_DB_FINANCE` | finance | false | gastos operativos + P&L |
| `USE_DB_MIKROTIK` | mikrotik | false | repository/DB — **NO activar** (gated) |
| `USE_DB_DASHBOARD` | dashboard | false | repository/DB |
| `USE_DB_GIS` | gis | false | repository/DB |
| `USE_DB_AUTOMATIONS` | automations | false | repository/DB |
| `USE_DB_REPORTS` | reports | false | repository/DB |
| `USE_DB_SECURITY` | security | false | repository/DB |
| `USE_DB_PAYMENTS` | payments | false | repository/DB |

## Flags independientes

| Flag | Helper | Default | Efecto cuando `true` |
| --- | --- | --- | --- |
| `USE_DB_ROUTER_ENROLLMENT` | `useDbRouterEnrollment()` | false | `SupabaseRouterEnrollmentRepository` |
| `USE_DB_WIREGUARD` | `useDbWireguard()` | false | `SupabaseWireguardRepository` (requiere Supabase admin) |

## Configuración de entorno relacionada (no son flags de persistencia)

Viven en `backend/config/env.ts` (validadas con fail-fast en producción):

| Variable | Propósito |
| --- | --- |
| `AUTH_TRUST_HEADERS` | Solo dev/test. En prod **debe** ser `false` (identidad por JWT Supabase). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | Auth verificable + repos DB. |
| `MIKROTIK_CREDENTIALS_KEY` | Cifrado robusto de secretos (WireGuard/MikroTik). |
| `DATABASE_URL` | Conexión a Postgres/Supabase. |

## Proveedores con selección por entorno (no flags de DB)

- IPAM: `backend/domains/ipam/providers/index.ts` selecciona mock/routeros.
- RouterOS read-only: `backend/domains/routeros-readonly/providers/index.ts`.
- Payments: `backend/domains/payments/providers/index.ts` (manual / mercadopago / openpay).

## Reglas de oro

1. Default siempre `false` / seguro.
2. Nunca activar `USE_DB_MIKROTIK` ni integraciones live sin autorización (gated).
3. Toda flag nueva se registra **aquí** y en `backend/config/feature-flags.ts`.
