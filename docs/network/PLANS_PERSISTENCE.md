# NugaCore — Persistencia del dominio Plans (Fase 3)

> Última actualización: 2026-06-03 · Estado: **implementado**, detrás de `USE_DB_PLANS` (default `false`).
> Relacionado: [PLANS_AUDIT.md](../audits/PLANS_AUDIT.md) · [CUSTOMERS_PERSISTENCE.md](./CUSTOMERS_PERSISTENCE.md) · [DATA_CONTRACT.md](../architecture/DATA_CONTRACT.md)

---

## 1. Qué se hizo

Se conectó el **dominio Plans (planes de internet)** a persistencia real
(Supabase/PostgreSQL), reusando exactamente el patrón de Customers
(repository → service → mappers → feature flag), **sin tocar el frontend** y
**manteniendo el contrato de API v1 intacto**.

- `USE_DB_PLANS=false` (default): comportamiento **idéntico** al anterior (store en memoria).
- `USE_DB_PLANS=true`: el CRUD de planes se lee/escribe en Supabase (tabla `public.plans`).
- El cambio es **reversible** con un solo flag (rollback inmediato).

> El resto de dominios **no** se tocó (Billing, MikroTik, Inventory, Tickets, GIS).
> Customers y Auth siguen intactos.

---

## 2. Esquema usado

La tabla `public.plans` **ya existía y ya estaba sembrada** en las migraciones
(no se creó esquema nuevo). Fusiona en una sola fila lo que en el mock vivía
repartido en `store.PLANS` (tipo `Plan`) y `store.PLAN_METADATA`.

```sql
CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,                                  -- slug: 'plan-basic'
  name TEXT NOT NULL UNIQUE,
  speed_down_mbps INTEGER NOT NULL,
  speed_up_mbps INTEGER NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  tech_type plan_tech_type NOT NULL DEFAULT 'PPPoE',         -- Plan.type
  business_type plan_business_type NOT NULL DEFAULT 'Residencial', -- isActive/businessType
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()                  -- trigger trg_plans_modtime
);
```

**Mapeo de campos (`mappers.ts`):** la ÚNICA traducción de nombres ocurre aquí;
los valores de enum **no** se traducen.

| DB (snake_case) | App (`PlanRecord`, camelCase) |
|---|---|
| `id` | `id` |
| `name` | `name` |
| `speed_down_mbps` | `speedMbpsDown` |
| `speed_up_mbps` | `speedMbpsUp` |
| `price` (NUMERIC → `Number()`) | `price` |
| `tech_type` | `type` (`PPPoE`/`Hotspot`/`DHCP`/`Static`) |
| `business_type` | `businessType` (`Residencial`/`Empresarial`/`Dedicado`) |
| `is_active` | `isActive` |

`PlanRecord = Plan (src/types.ts) + { businessType, isActive }` — es decir, lo que la
API v1 ya exponía (`{ ...plan, isActive, businessType }`).

---

## 3. Arquitectura

```
routes.ts (HTTP + RBAC, API v1)        ← sin cambios de contrato
   │  llama a
service.ts (PlansService)              ← validaciones + reglas, sin Express
   │  usa
repository.ts (PlansRepository)        ← interfaz
   ├── StorePlansRepository            (USE_DB_PLANS=false → store memoria)
   └── SupabasePlansRepository         (USE_DB_PLANS=true  → Supabase)
        │ traduce con
        └── mappers.ts (snake_case ↔ camelCase, sin traducir enums)
```

`getPlansService()` elige el repositorio según el flag. Si se pide modo DB sin
Supabase configurado, **falla rápido con un error claro**.

---

## 4. Feature flag

| Variable | Default | Efecto |
|----------|---------|--------|
| `USE_DB_PLANS` | `false` | `false` → store mock; `true` → Supabase (`public.plans`). |

Declarada en `backend/config/feature-flags.ts` (`plans` → `USE_DB_PLANS`) y en
`.env.example` / `.env.production.example`. No se elimina el mock.

---

## 5. Endpoints (contrato v1 **sin cambios**)

Mismas rutas, mismos payloads, mismas formas de respuesta:

| Método | Ruta | RBAC | Notas |
|--------|------|------|-------|
| GET | `/api/plans` | lectura (todos) | filtros `q`, `status` (`active`/`inactive`), `businessType` |
| GET | `/api/plans/:id` | lectura (todos) | `404` si no existe |
| POST | `/api/plans` | super admin / administrador | `201` + plan; `409` si nombre duplicado |
| PUT | `/api/plans/:id` | super admin / administrador | `200` + plan; `404` si no existe |
| DELETE | `/api/plans/:id` | super admin / administrador | `204`; `409` si está en uso; `404` si no existe |

Forma de respuesta (GET/POST/PUT):

```jsonc
{ "id": "plan-basic", "name": "Nuga Residencial 20M", "speedMbpsDown": 20,
  "speedMbpsUp": 5, "price": 299, "type": "PPPoE",
  "isActive": true, "businessType": "Residencial" }
```

> Cambio aditivo: los errores ahora incluyen `code` además de `error`
> (p.ej. `{ "error": "Invalid plan type", "code": "INVALID_ENUM" }`), igual que
> en el resto de la API migrada. El campo `error` se conserva.

---

## 6. Validaciones (`service.ts`)

**Alta (`POST` / `validateCreate`):**
- `name` requerido (no vacío).
- `speedMbpsDown`, `speedMbpsUp`, `price` requeridos, numéricos y **no negativos**.
- `type` (técnico) requerido y válido (`PPPoE`/`Hotspot`/`DHCP`/`Static`, case-insensitive).
- `businessType` opcional → normaliza a `Residencial` (default), `Empresarial` o `Dedicado`.
- `isActive` opcional → `true` por default.
- Nombre único → `409` si ya existe (case-insensitive).

**Edición (`PUT` / `buildUpdatePatch`):** solo valida/coerciona las claves presentes;
rechaza `400` ante velocidad/precio negativos o no numéricos, `type` inválido o `name` vacío.

Los errores responden con el `errorHandler` global: `{ error, code }` y el status
correspondiente (`400` BadRequest, `409` Conflict, `404` Not Found).

---

## 7. RBAC

| Rol | Permiso sobre Plans |
|-----|---------------------|
| Super Admin | CRUD completo |
| Administrador | CRUD completo |
| Cobranza | lectura |
| Técnico | lectura |
| Soporte | lectura |
| Solo lectura | lectura |

Lectura: `READ_ROLES` (los 6 roles). Escritura: `['super admin', 'administrador']`.
Idéntico al esquema previo y a lo solicitado.

---

## 8. UI

No existe pantalla CRUD dedicada de planes. El frontend consume planes en **modo
lectura** (`src/App.tsx` → `/api/plans`; `src/components/CrmModule.tsx` usa `plan.id`
y `plan.name` para el selector de plan al crear/convertir clientes). Como el contrato
de respuesta no cambió, **no se requiere ningún cambio de frontend ni rediseño**.

Los campos `isActive`/`businessType` quedan disponibles (aditivos) para una futura
pantalla de administración de planes; el tipo `Plan` del frontend seguirá funcionando
porque solo lee los 6 campos base.

---

## 9. Cómo probar — modo MOCK (default, sin Supabase)

```bash
# USE_DB_PLANS ausente o false
npm run typecheck && npm test && npm run build
npm run dev:tsx           # http://localhost:3000
```
- El CRM se ve y funciona **igual** (selector de planes intacto).
- Crear/editar/borrar planes funciona; **al reiniciar el servidor los datos se pierden** (esperado en mock).
- Las pruebas de contrato (`tests/contract/plans.contract.test.ts`) garantizan que el refactor no rompió nada.

---

## 10. Cómo probar — modo DB (USE_DB_PLANS=true, requiere Supabase staging)

> ⚠️ Requiere un proyecto Supabase de **staging**.

1. **Aplicar migraciones** (si no se hizo ya para Customers):
   - `supabase/migrations/20260531000000_init_schema.sql`
   - `supabase/migrations/20260531000001_rls_and_seeds.sql` (siembra los 5 planes)
2. **Configurar `.env`:**
   ```env
   SUPABASE_URL=https://<tu-proyecto>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # solo backend, nunca al cliente
   USE_DB_PLANS=true
   ```
3. **Arrancar:** `npm run dev:tsx` (verás en logs `Plans domain: persistencia = Supabase`).
4. **Crear/editar un plan** (`POST`/`PUT /api/plans`).
5. **Reiniciar el servidor** y confirmar con `GET /api/plans` que persistió.
6. **Pruebas de integración DB:**
   ```bash
   RUN_DB_TESTS=true npm run test:db
   ```
   Ejecuta `tests/contract/plans.db.contract.test.ts` (create→find→update→remove en Supabase)
   junto al de Customers. Sin Supabase configurado se **omite**.

---

## 11. Cómo hacer rollback

**Inmediato (sin redeploy de código):**
```env
USE_DB_PLANS=false
```
Reiniciar el servidor → vuelve al store en memoria. El código DB queda inerte.

**Por código:** `git revert <sha-de-fase-3>` (el dominio vuelve a su estado anterior).

> Como no se borró el mock ni se migraron datos, el rollback es seguro y no destructivo.

---

## 12. Riesgos restantes

| Riesgo | Severidad | Nota |
|--------|:---------:|------|
| Renombrar a un nombre existente en DB | 🟡 | `name` es `UNIQUE`; el `PUT` no chequea duplicados (igual que el mock) → en DB un rename colisionante daría error. El `409` solo se valida en alta (`POST`). |
| Borrado de plan en uso | 🟢 | La FK `clients.plan_id` es `ON DELETE SET NULL`; el bloqueo `409` se mantiene en la capa de aplicación (chequeo contra `clients`). |
| Efectos cruzados con Billing | 🟢 | Billing (factura inicial que lee `plan.price`) sigue en el store; fuera de alcance de esta fase. |
| Generación de id `plan-N` en DB | 🟡 | `generateId()` toma el máximo de sufijos numéricos; en alta concurrencia hay riesgo de colisión. Aceptable para piloto. |
| Verificación DB a nivel repository | 🟢 | **Hecha (2026-06-03):** `RUN_DB_TESTS=true npm run test:db` pasó contra el Supabase staging real (create→find→update→remove, `findByName`, `isInUse`). |
| Verificación HTTP end-to-end con `USE_DB_PLANS=true` | 🟡 | Pendiente de validar Hermes en staging con el servidor (reinicio + persistencia vía API). Runbook §13. |

---

## 13. Instrucciones para Hermes (validación en staging)

1. En el entorno de **staging** (Coolify), confirmar que las migraciones ya aplicaron
   `public.plans` con los 5 seeds (`GET /api/plans` los lista).
2. Poner `USE_DB_PLANS=true` (manteniendo `USE_DB_CUSTOMERS` como esté) y reiniciar.
3. Verificar en logs: `Plans domain: persistencia = Supabase (USE_DB_PLANS=true)`.
4. **Smoke test CRUD:**
   - `POST /api/plans` (como admin) → crear "Plan Hermes QA".
   - `GET /api/plans` → aparece.
   - **Reiniciar el servicio** → `GET /api/plans` aún lo muestra (persistió).
   - `PUT` para cambiar precio/`isActive` → verificar.
   - `DELETE` del plan QA → `204` (no está en uso).
   - `DELETE` de `plan-basic` → `409` (en uso por clientes sembrados).
5. **RBAC:** con un rol de lectura (`solo lectura`/`cobranza`/`tecnico`/`soporte`),
   `GET` funciona y `POST/PUT/DELETE` devuelven `403`.
6. (Opcional) correr `RUN_DB_TESTS=true npm run test:db` apuntando a staging.
7. Registrar el resultado (OK / hallazgos) como se hizo con Customers/Auth.

> **No avanzar a Billing, MikroTik ni Inventory** sin aprobación.
