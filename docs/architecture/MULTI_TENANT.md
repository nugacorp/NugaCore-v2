# Multi-tenant foundation (Fase 11)

## Modelo

| Pieza | Rol |
| --- | --- |
| `tenants` | Organización WISP |
| `tenant_memberships` | Usuario ↔ tenant + rol (`owner`/`admin`/`member`/`readonly`) |
| `tenant_id` en SSOT | `clients`, `towers`, `tower_onboarding_profiles`, `plans`, `invoices`, `network_sectors`, `radius_accounting` |
| `AuthContext.tenantId` | Tenant activo por request |
| Backend service_role | Persistencia Express (bypass RLS) + filtro app-layer |
| RLS authenticated | Acceso directo cliente solo si `is_tenant_member(tenant_id)` o claim JWT |

## Flags

```bash
MULTI_TENANT_ENABLED=true   # activa aislamiento por tenant
USE_DB_TENANCY=true         # tenants/memberships en Supabase (si no, store)
```

Sin `MULTI_TENANT_ENABLED`, el modo es **single-wisp** (`tenant-default`) — compatible con despliegues actuales.

## API

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/api/tenancy/status` | `mode`: `single-wisp` \| `multi-tenant` |
| GET | `/api/tenants` | Lista (filtrada por membership si no admin) |
| GET | `/api/tenants/default` | Tenant default |
| POST | `/api/tenants` | Crea WISP (+ owner membership) |
| GET/POST | `/api/tenants/:id/memberships` | Membresías del tenant |
| GET | `/api/tenancy/memberships` | Membresías del usuario |
| GET | `/api/auth/me` | Incluye `tenantId` |

Header opcional: `x-tenant-id` (solo si el usuario es miembro; en trusted-headers/dev puede override).

## Dominios ya scoped

- Customers (`/api/clients*`)
- Network towers + onboarding
- RADIUS sessions

Otros dominios deben adoptar `tenantIdFromRequest(req)` + `.eq('tenant_id', …)` / stamp en create.

## Migración

`supabase/migrations/20260716200000_multi_tenant_foundation.sql`
