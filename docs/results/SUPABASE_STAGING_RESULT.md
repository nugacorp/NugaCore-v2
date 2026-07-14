# NugaCore — Resultado de Validación en Supabase Staging (Fase 1)

> Fecha: 2026-06-01 · Alcance: validar el dominio **Customers** con `USE_DB_CUSTOMERS=true` contra **Supabase Cloud real**.
> Sin tocar frontend/UI, sin migrar otros módulos, sin auth real, sin datos reales.

---

## 1. Método usado para conectar Supabase

- **Supabase CLI** (vía `npx supabase@latest`, v2.104.0) autenticado con un **Personal Access Token** provisto por el dueño (cargado solo en la variable de entorno `SUPABASE_ACCESS_TOKEN`, nunca commiteado).
  - El CLI instalado por scoop (v2.67.1) tenía un bug (enum de `--region` vacío) que impedía `projects create`; por eso se usó el CLI más reciente vía `npx`.
- **Management API** (`https://api.supabase.com/v1/projects/{ref}/database/query`) con el mismo token para aplicar el seed y verificar conteos.
- No hay MCP de Supabase ni acceso a Coolify por CLI/API en este entorno.

---

## 2. Proyecto creado

| Campo | Valor |
|-------|-------|
| Nombre | **nugacore-staging** |
| Project ref | `elshnzkceutvjzxvzqad` (no es secreto; aparece en la URL) |
| Organización | NugaCorp (`zkjlliihyfgeznuwjemo`) |
| Región | `us-west-1` (West US / N. California — la más cercana a México) |
| URL | `https://elshnzkceutvjzxvzqad.supabase.co` |

> ⚠️ Para liberar cupo (límite de 2 proyectos gratis) el dueño autorizó **borrar** los 2 proyectos previos (`NugaCorp Wireless` y `Selectos BCN's Project`). Acción **irreversible** ya ejecutada y confirmada por el dueño.
>
> 🔁 **Recreado por seguridad (2026-06-03):** el primer `nugacore-staging` (ref `dcuohhbojxylgmdiiviy`) se **borró** porque su `service_role` legacy quedó expuesta en un log de sesión y la rotación de dashboard no la invalidaba. Este proyecto (`elshnzkceutvjzxvzqad`) es el **vigente**; las keys del anterior están muertas.

---

## 3. Migraciones aplicadas

Aplicadas con `supabase db push` (tras `supabase init` + `supabase link`):

1. `20260531000000_init_schema.sql` ✅ (esquema completo: tablas, enums, índices, triggers)
2. `20260531000001_rls_and_seeds.sql` ✅ (RLS deny-by-default + seeds de catálogo)

Verificación post-migración: `plans` = **5 filas** sembradas correctamente.

> RLS quedó habilitada (deny-by-default). El backend usa la **service-role key** (bypassa RLS), por lo que el piloto funciona sin políticas permisivas adicionales — alineado con "no activar RLS compleja que rompa el piloto".

---

## 4. Seed ficticio aplicado

`supabase/seeds/customers_staging_seed.sql` (vía Management API, sin comentarios) ✅

Resultado: `clients` = **2** registros **ficticios** (`c-staging-1` active, `c-staging-2` lead) + 1 evento de timeline. **No hay datos reales de clientes.**

---

## 5. Variables necesarias (sin valores secretos)

`.env` local (gitignored — **no commiteado**):

| Variable | ¿Secreto? | Origen |
|----------|:---------:|--------|
| `NODE_ENV` | no | `development` (local) |
| `USE_DB_CUSTOMERS` | no | `true` |
| `AUTH_TRUST_HEADERS` | no | `true` **solo local** (para probar alta por API sin auth real) |
| `SUPABASE_URL` | no | `https://elshnzkceutvjzxvzqad.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **SÍ** | Dashboard → Project Settings → API, o `supabase projects api-keys` |
| `SUPABASE_ANON_KEY` | medio | idem |
| `VITE_SUPABASE_URL` | no | igual a SUPABASE_URL (build-time) |
| `VITE_SUPABASE_ANON_KEY` | medio | anon key (build-time) |
| `SUPABASE_DB_PASSWORD` | **SÍ** | autogenerado al crear (solo en `.env` local) |

---

## 6. Pruebas ejecutadas

| Verificación | Resultado |
|--------------|-----------|
| `npm run typecheck` | ✅ sin errores |
| `npm test` (con `USE_DB_CUSTOMERS=true` + Supabase) | ✅ **32/32** (la prueba de contrato DB **ya no se omite**: create→find→update→remove contra Supabase real, ~1.4 s) |
| `npm run build` | ✅ `dist/server.cjs` + assets |
| `npm test` (modo CI/mock, sin Supabase) | ✅ 30 passed, 2 skipped (la DB se omite correctamente) |

> Ajuste menor: `tests/contract/health.contract.test.ts` se hizo **consciente del flag** (`persistence` = `in-memory` o `mixed` según `USE_DB_CUSTOMERS`), para pasar en ambos modos.

---

## 7. Resultado de persistencia (crear → reiniciar → leer)

1. Servidor con `USE_DB_CUSTOMERS=true` → `/api/health` reporta `persistence=mixed`, `domainsOnDb=[customers]`.
2. `GET /api/clients` devuelve los registros **de la DB** (`c-staging-1/2`), no los del mock.
3. `POST /api/clients` ("DB Persist Test") → crea **`c-3`** (status `active`).
4. **Reinicio del servidor** (proceso nuevo).
5. `GET /api/clients/c-3` → **sigue existiendo** ("DB Persist Test", `active`).

✅ **Persistencia real confirmada**: los datos sobreviven al reinicio del servidor.

> Nota: la prueba de contrato `POST /api/clients` de `npm test` también escribe en la DB cuando el flag está activo, generando clientes de prueba (`c-1`, `c-2`, …) en staging. Se limpian al final dejando solo el seed ficticio.

---

## 8. Resultado de rollback (`USE_DB_CUSTOMERS=false`)

1. Reinicio con `USE_DB_CUSTOMERS=false`.
2. `/api/health` → `persistence=in-memory`, `domainsOnDb=[]`.
3. `GET /api/clients` → devuelve el **mock** (`Sofia Rodriguez`, `c-1..c-5`, leads), **no** la DB.

✅ **Rollback inmediato por feature flag**, sin redeploy. La base Supabase queda **intacta** (`c-3` permanece en la DB). Cero pérdida de datos.

---

## 9. Variables para Coolify (pegar manualmente — no tengo acceso a Coolify aquí)

En el servicio NugaCore de Coolify, define estas variables (los **valores secretos** se obtienen del dashboard de Supabase → Project Settings → API):

**Runtime (no build):**
```
NODE_ENV=production
AUTH_TRUST_HEADERS=false
USE_DB_CUSTOMERS=true
SUPABASE_URL=https://elshnzkceutvjzxvzqad.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<SECRETO – service_role key del proyecto>
MIKROTIK_CREDENTIALS_KEY=<SECRETO – si ya existe>
```

**Build-time (marcar como Build Variable en Coolify, se incrustan en el bundle):**
```
VITE_SUPABASE_URL=https://elshnzkceutvjzxvzqad.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key del proyecto>
```

> ⚠️ **No** pongas `SUPABASE_SERVICE_ROLE_KEY` como build/VITE: es de servidor. Nunca debe llegar al bundle del cliente.

---

## 10. Riesgos pendientes

| Riesgo | Severidad | Nota |
|--------|:---------:|------|
| **Service-role key expuesta en el log de esta sesión** | 🔴 | Un error del CLI (BOM en `.env`) eco el contenido del `.env`, mostrando anon + service_role. **Acción requerida: ROTAR las API keys** del proyecto (Dashboard → Settings → API → Reset) o tratar este staging como desechable. |
| **Token PAT** usado | 🟠 | El archivo del token (en el Escritorio) será borrado; **rota/revoca el PAT** por si acaso (su nombre reflejaba parte del token). |
| **Escritura en PROD necesita Fase 2** | 🟠 | Con `AUTH_TRUST_HEADERS=false` en prod y sin auth real, los `POST/PUT` de clientes responderán 401 (no hay JWT). El alta por UI en prod **requiere Fase 2 (auth real)**. Las lecturas (GET) funcionan. |
| **Efectos cruzados sin migrar** | 🟡 | En modo DB, crear/convertir lead persiste el cliente en DB, pero factura/ONU/logs siguen en el store (Billing/Network aún mock). |
| **Generación de IDs `c-N`** | 🟡 | Por máximo actual; posible colisión en concurrencia. Secuencia en F3. |
| **Borrado de proyectos previos** | 🟡 | `NugaCorp Wireless` y `Selectos` fueron eliminados de forma irreversible (autorizado). |

---

## 11. Siguiente paso recomendado

1. **Rotar** las API keys del proyecto staging (por la exposición en el log) y revocar el PAT.
2. **Fase 2 — Autenticación real (Supabase Auth)**: cerrar el hueco que hoy obliga a `AUTH_TRUST_HEADERS` y habilitar el alta por UI en producción con JWT verificado. Es el bloqueante para usar Customers-DB en prod de forma segura.
3. Tras Fase 2, continuar **Fase 3** (migrar `plans`, luego `billing`) reutilizando este patrón.

> **No avanzar a Fase 2 sin aprobación del dueño.**
