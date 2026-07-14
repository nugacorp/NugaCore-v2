# NugaCore — Auditoría del dominio Plans (Fase 3, TAREA 1)

> Fecha: 2026-06-03 · Estado previo a la migración: **store en memoria (mock)**.
> Relacionado: [DATA_CONTRACT.md](../architecture/DATA_CONTRACT.md) · [CUSTOMERS_PERSISTENCE.md](../network/CUSTOMERS_PERSISTENCE.md) · [PLANS_PERSISTENCE.md](../network/PLANS_PERSISTENCE.md)

---

## 1. Resumen

El dominio **Plans** (planes de internet) hoy vive **100% en el store en memoria**
(`backend/state/store.ts`), repartido en **dos estructuras**:

- `store.PLANS` → tipo `Plan` (`src/types.ts`): los 6 campos base.
- `store.PLAN_METADATA` → tipo `PlanMetadata`: `businessType` + `isActive`.

La capa HTTP (`backend/domains/plans/routes.ts`) **combina** ambas en cada respuesta:
`{ ...plan, isActive, businessType }`. Es decir, el "objeto plan" que ve el frontend es
`Plan` extendido con `businessType` e `isActive`.

A diferencia de otros dominios, la **tabla `public.plans` ya existe y ya está sembrada**
en las migraciones (no hay que crear esquema), y **fusiona** ambas estructuras en una sola fila.

---

## 2. Endpoints actuales

Definidos en `backend/domains/plans/routes.ts` y montados en `register-routes.ts`:

| Método | Ruta | RBAC actual | Descripción |
|--------|------|-------------|-------------|
| GET    | `/api/plans` | `READ_ROLES` (todos) | Lista con filtros `q`, `status`, `businessType` |
| GET    | `/api/plans/:id` | `READ_ROLES` | Un plan por id |
| POST   | `/api/plans` | `super admin`, `administrador` | Alta de plan |
| PUT    | `/api/plans/:id` | `super admin`, `administrador` | Edición de plan |
| DELETE | `/api/plans/:id` | `super admin`, `administrador` | Baja de plan (bloquea si está en uso) |

> Los 5 endpoints del contrato esperado (TAREA 3) **ya existen**. No falta ninguno.

---

## 3. Contrato actual (forma de respuesta)

`GET /api/plans` y `GET /api/plans/:id` devuelven objetos con esta forma
(combinación de `Plan` + metadata):

```jsonc
{
  "id": "plan-basic",
  "name": "Nuga Residencial 20M",
  "speedMbpsDown": 20,
  "speedMbpsUp": 5,
  "price": 299,
  "type": "PPPoE",          // técnico: PPPoE | Hotspot | DHCP | Static
  "isActive": true,         // de PlanMetadata
  "businessType": "Residencial" // Residencial | Empresarial | Dedicado
}
```

- `POST` responde `201` con el mismo objeto combinado.
- `PUT` responde `200` con el objeto combinado actualizado.
- `DELETE` responde `204` sin cuerpo; `409` si el plan está en uso; `404` si no existe.
- `POST` duplicado por nombre → `409 { error: 'Plan name already exists' }`.

> El contrato de **lectura** está congelado por `tests/contract/api-v1.contract.test.ts`
> (claves `id, name, speedMbpsDown, speedMbpsUp, price, type`).

---

## 4. Campos usados por la UI

No existe una pantalla CRUD dedicada de planes. El frontend consume planes en **modo
lectura** para poblar selectores y mostrar el plan de un cliente:

- `src/App.tsx`: `fetchJson('/api/plans')` → estado `plans: Plan[]`.
- `src/components/CrmModule.tsx`: usa `plan.id`, `plan.name` (selector de plan al crear/convertir cliente y al mostrar el plan del cliente).

El tipo `Plan` del frontend (`src/types.ts`) **solo declara los 6 campos base**
(`id, name, speedMbpsDown, speedMbpsUp, price, type`). Los campos `isActive` y
`businessType` que agrega el backend son **aditivos**: el frontend los ignora hoy, pero
quedan disponibles para una futura pantalla de administración de planes.

---

## 5. Estados de un plan

- **Técnico** (`type`): `PPPoE | Hotspot | DHCP | Static` (enum `plan_tech_type` en DB).
- **Negocio** (`businessType`): `Residencial | Empresarial | Dedicado` (enum `plan_business_type`).
- **Disponibilidad** (`isActive`): `true | false`. El filtro `status=active|inactive` de
  `GET /api/plans` se resuelve contra este booleano.

---

## 6. Tabla `public.plans` (ya existente en Supabase)

Definida en `supabase/migrations/20260531000000_init_schema.sql` y sembrada en
`supabase/migrations/20260531000001_rls_and_seeds.sql`:

```sql
CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,                  -- slug: 'plan-basic'
  name TEXT NOT NULL UNIQUE,
  speed_down_mbps INTEGER NOT NULL,
  speed_up_mbps INTEGER NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  tech_type plan_tech_type NOT NULL DEFAULT 'PPPoE',
  business_type plan_business_type NOT NULL DEFAULT 'Residencial',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Mapeo de nombres (snake_case ↔ camelCase):**

| DB | App (`PlanRecord`) |
|----|--------------------|
| `id` | `id` |
| `name` | `name` |
| `speed_down_mbps` | `speedMbpsDown` |
| `speed_up_mbps` | `speedMbpsUp` |
| `price` | `price` |
| `tech_type` | `type` |
| `business_type` | `businessType` |
| `is_active` | `isActive` |

> Los **valores de enum no se traducen** (la DB guarda `PPPoE`, `Residencial`, … igual que el frontend).
> Hay trigger `trg_plans_modtime` que mantiene `updated_at`.

Seeds existentes (`is_active = TRUE` en los 5):

| id | name | down/up | price | tech | business |
|----|------|---------|-------|------|----------|
| `plan-basic` | Nuga Residencial 20M | 20/5 | 299 | PPPoE | Residencial |
| `plan-plus` | Nuga Residencial 50M | 50/10 | 449 | PPPoE | Residencial |
| `plan-ultra` | Nuga Residencial 100M | 100/20 | 699 | PPPoE | Residencial |
| `plan-corp-small` | Nuga Empresarial 100M Dedicado | 100/100 | 2499 | Static | Empresarial |
| `plan-corp-gig` | Nuga Corp Giga Simetrico | 1000/1000 | 11999 | Static | Dedicado |

---

## 7. Migraciones existentes

- `20260531000000_init_schema.sql` → crea `public.plans`, enums `plan_tech_type` /
  `plan_business_type`, trigger `updated_at` e índices.
- `20260531000001_rls_and_seeds.sql` → habilita RLS deny-by-default y **siembra los 5 planes**.

> **No se requieren nuevas migraciones** para esta fase: el esquema y los seeds ya están.

---

## 8. Relación con Customers / Billing

- **Customers → Plans:** `public.clients.plan_id` tiene FK a `public.plans(id)` con
  `ON DELETE SET NULL`. En el store mock, `routes.ts` de customers valida que el `planId`
  exista en `store.PLANS` al crear/editar clientes.
- **Borrado de plan en uso:** el contrato **mock bloquea** (`409`) borrar un plan si algún
  cliente lo usa (chequea `store.CLIENTS`). En DB, la FK es `SET NULL` (no bloquea a nivel
  base), por lo que el bloqueo `409` debe seguir **implementándose en la capa de aplicación**
  (repository), para no romper el contrato.
- **Billing → Plans:** al convertir un lead, customers `routes.ts` lee `plan.price` para
  generar la factura inicial. Eso vive en el dominio Billing/Customers (aún mock) y **no se
  toca** en esta fase.

---

## 9. Riesgos identificados

| Riesgo | Severidad | Nota |
|--------|:---------:|------|
| Doble fuente mock (`PLANS` + `PLAN_METADATA`) | 🟢 | Se fusiona en una sola fila/`PlanRecord` al migrar. El modo mock se conserva sin cambios. |
| Borrado de plan en uso | 🟡 | La FK `ON DELETE SET NULL` no bloquea; el `409` se mantiene a nivel repository (chequeo contra `clients`). |
| `name UNIQUE` en DB | 🟡 | Renombrar a un nombre existente fallaría en DB (el mock lo permitía). Se preserva el `409` solo en alta (POST), igual que hoy. |
| `price` NUMERIC como string | 🟢 | El mapper hace `Number(row.price)` para respetar `price: number` del contrato. |
| Sin UI CRUD dedicada | 🟢 | No se rediseña frontend; la API queda lista para una futura pantalla de administración. |
| Generación de id `plan-N` en DB | 🟢 | Calcula el máximo de sufijos numéricos; ids semánticos (`plan-basic`) se ignoran. Aceptable para piloto. |

---

## 10. Conclusión

El dominio Plans es un **buen candidato de bajo riesgo**: el esquema y los seeds ya existen,
los 5 endpoints ya están, el RBAC ya coincide con el solicitado y no hay UI que rediseñar.
La migración consiste en introducir `repository / service / mappers` detrás de
`USE_DB_PLANS` (default `false`), preservando el contrato v1 byte por byte en modo mock.
