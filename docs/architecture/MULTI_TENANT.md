# Multi-tenant foundation (Fase 11)

## Modelo

| Pieza | Rol |
| --- | --- |
| `tenants` | Organización WISP |
| `tenant_memberships` | Usuario ↔ tenant + rol (`owner`/`admin`/`member`/`readonly`) — **fuente de verdad** |
| `tenant_id` en SSOT | `clients`, `towers`, `tower_onboarding_profiles`, `plans`, `invoices`, `network_sectors`, `radius_accounting` |
| `AuthContext.tenantId` | Tenant activo por request (backend) |
| Backend service_role | Persistencia Express + filtro app-layer + RBAC |
| RLS | **service_role only** (deny-by-default para anon/authenticated) |

## Seguridad (no negociable)

1. **No confiar en `user_metadata.tenant_id`**. El usuario lo edita con `supabase.auth.updateUser` y la anon key del frontend.
2. **`is_tenant_member` solo mira `tenant_memberships`** (sin claims JWT).
3. **Sin políticas `authenticated` FOR ALL** sobre SSOT: el frontend no usa PostgREST; abrirlas sería superficie de ataque (bypass de RBAC Express).
4. **`MULTI_TENANT_ENABLED=false` no apaga RLS**. Solo desactiva el scoping en el backend. Por eso esta migración no crea políticas authenticated “por si acaso”.

Si en el futuro se quiere lectura directa PostgREST, añadir políticas **SELECT** (nunca FOR ALL) basadas solo en `is_tenant_member`, y mantener writes en el backend.

## Flags

```bash
MULTI_TENANT_ENABLED=true   # aislamiento app-layer por tenant
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
Claim opcional: `app_metadata.tenant_id` (solo service_role); también requiere membership.

## Dominios ya scoped (app-layer)

- Customers (`/api/clients*`)
- Network towers + onboarding
- RADIUS sessions

Otros dominios deben adoptar `tenantIdFromRequest(req)` + `.eq('tenant_id', …)` / stamp en create.

## Migración

`supabase/migrations/20260716200000_multi_tenant_foundation.sql`
