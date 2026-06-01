# NugaCore — Persistencia del dominio Customers (Fase 1, piloto)

> Última actualización: 2026-06-01 · Estado: **piloto implementado**, detrás de `USE_DB_CUSTOMERS` (default `false`).
> Relacionado: [DATA_CONTRACT.md](DATA_CONTRACT.md) · [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) · `backend/core/README.md`

---

## 1. Qué se hizo

Se conectó **únicamente el dominio Clientes (customers)** a persistencia real (Supabase/PostgreSQL), siguiendo el patrón de Fase 0 (repository → service → mappers → feature flag), **sin tocar el frontend** y **manteniendo el contrato de API v1 intacto**.

- `USE_DB_CUSTOMERS=false` (default): comportamiento **idéntico** al anterior (store en memoria).
- `USE_DB_CUSTOMERS=true`: el CRUD de clientes y su timeline se leen/escriben en Supabase.
- El cambio es **reversible** con un solo flag (rollback inmediato).

> El resto de dominios **no** se tocó. El backend mock sigue intacto.

---

## 2. Arquitectura del piloto

```
routes.ts (HTTP + RBAC, API v1)         ← sin cambios de contrato
   │  llama a
service.ts (CustomersService)           ← validaciones + reglas, sin Express
   │  usa
repository.ts (CustomersRepository)     ← interfaz
   ├── StoreCustomersRepository         (USE_DB_CUSTOMERS=false → store memoria)
   └── SupabaseCustomersRepository      (USE_DB_CUSTOMERS=true  → Supabase)
        │ traduce con
        └── mappers.ts (snake_case ↔ camelCase, sin traducir enums)
```

La selección de repositorio la hace `getCustomersService()` según el flag. Si se pide
modo DB sin Supabase configurado, **falla rápido con un error claro**.

---

## 3. Tablas usadas

| Tabla | Uso | Notas |
|-------|-----|-------|
| `public.clients` | Entidad cliente (CRUD + filtros) | PK `TEXT` slug `c-N` |
| `public.client_timeline` | Historial del cliente | FK `client_id` → `clients` (ON DELETE CASCADE) |
| `public.plans` | Validación de `plan_id` | Sembrada por `20260531000001_rls_and_seeds.sql` |

**Mapeo de campos `clients` ↔ `Client` (src/types.ts):**

| DB (snake_case) | App (camelCase) | DB | App |
|---|---|---|---|
| `full_name` | `name` | `ip_assigned` | `ip` |
| `type` | `type` | `mac_address` | `mac` |
| `status` | `status` | `ppp_user` | `pppoeUser` |
| `email`,`phone`,`address`,`city`,`lat`,`lng`,`notes` | iguales | `ppp_password` | `pppoePassword` |
| `connection_type` | `connectionType` | `contract_id` | `contractId` |
| `plan_id` | `planId` | `installation_photos` | `installationPhotos` |
| | | `installation_date` | `installationDate` |

> Los valores de enum **no se traducen** (la DB guarda `active`/`lead`/… igual que el frontend).

---

## 4. Endpoints afectados (contrato v1 **sin cambios**)

Mismas rutas, mismos payloads, mismas formas de respuesta:

- `GET /api/clients` (filtros `status/type/city/planId/q`)
- `GET /api/clients/:id`
- `GET /api/clients/:id/history`
- `POST /api/clients` (incluye conversión de lead)
- `PUT /api/clients/:id`
- `DELETE /api/clients/:id`

> Internamente ahora pasan por el service; externamente son idénticos.

---

## 5. Archivos

**Creados**
- `backend/domains/customers/mappers.ts`
- `backend/domains/customers/repository.ts`
- `backend/domains/customers/service.ts`
- `supabase/seeds/customers_staging_seed.sql` (opcional, datos ficticios)
- `tests/unit/customers.mappers.test.ts`
- `tests/unit/customers.service.test.ts`
- `tests/contract/customers.db.contract.test.ts` (se omite sin Supabase)
- `docs/CUSTOMERS_PERSISTENCE.md`

**Modificados**
- `backend/domains/customers/routes.ts` (usa el service; async + `asyncHandler`)
- `backend/config/feature-flags.ts` (`customers` → `USE_DB_CUSTOMERS`)
- `.env.example`, `.env.production.example` (`USE_DB_CUSTOMERS`)

---

## 6. Cómo probar — modo MOCK (default, sin Supabase)

```bash
# USE_DB_CUSTOMERS ausente o false
npm run typecheck && npm test && npm run build
npm run dev:tsx           # http://localhost:3000
```
- El frontend (CRM) se ve y funciona **igual**.
- Crear cliente funciona; **al reiniciar el servidor los datos se pierden** (comportamiento esperado del mock).
- Las pruebas de contrato API v1 pasan (garantizan que el refactor no rompió nada).

---

## 7. Cómo probar — modo DB (USE_DB_CUSTOMERS=true, requiere Supabase staging)

> ⚠️ Requiere un proyecto Supabase de **staging**. No usar datos reales todavía.

1. **Aplicar el esquema y seeds** en Supabase:
   - `supabase/migrations/20260531000000_init_schema.sql`
   - `supabase/migrations/20260531000001_rls_and_seeds.sql`
   - (opcional) `supabase/seeds/customers_staging_seed.sql`
2. **Configurar `.env`:**
   ```env
   SUPABASE_URL=https://<tu-proyecto>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # solo backend, nunca al cliente
   USE_DB_CUSTOMERS=true
   ```
3. **Arrancar:** `npm run dev:tsx` (verás en logs `persistencia = Supabase`).
4. **Crear un cliente** desde el CRM (o `POST /api/clients`).
5. **Reiniciar el servidor.**
6. **Confirmar persistencia:** `GET /api/clients` (o el CRM) sigue mostrando el cliente creado → **persistió en la DB**.
7. **Pruebas de integración:** con esas variables presentes, `npm test` ejecuta también
   `tests/contract/customers.db.contract.test.ts` (create→find→update→remove en Supabase).

> En este repositorio, la verificación end-to-end del modo DB **no se ejecutó** porque no hay
> Supabase configurado en el entorno de desarrollo; el camino de código está cubierto por las
> pruebas unitarias del service/mappers y por la prueba de integración (que se omite sin Supabase).

---

## 8. Cómo hacer rollback

**Inmediato (sin redeploy de código):**
```env
USE_DB_CUSTOMERS=false
```
Reiniciar el servidor → vuelve al store en memoria. El código DB queda inerte.

**Por código:** `git revert <sha-de-fase-1>` (el dominio vuelve a su estado anterior).

> Como no se borró el backend mock ni se migraron datos, el rollback es seguro y no destructivo.

---

## 9. Riesgos restantes

| Riesgo | Severidad | Nota |
|--------|:---------:|------|
| Efectos cruzados sin migrar | 🟡 | En modo DB, crear/convertir un lead persiste el **cliente** en DB, pero la **factura/ONU/logs** generados siguen en el store (otros dominios aún mock) → inconsistencia temporal hasta migrar Billing/Network. Documentado y esperado en el piloto. |
| Generación de IDs `c-N` | 🟡 | `generateId()` calcula el máximo actual; en alta concurrencia hay riesgo de colisión. Aceptable para piloto; en F3 conviene secuencia/transacción. |
| `client_documents` no migrado | 🟢 | `Client.documents[]` no se lee/escribe desde DB en el piloto (tabla aparte, fuera de alcance). |
| Auth aún por trusted-headers | 🟠 | El acceso sigue dependiendo del esquema de auth de Fase 0 (ver SECURITY_AUDIT S-01). Se aborda en Fase 2, no aquí. |
| RLS deny-by-default | 🟢 | El backend usa service-role (bypassa RLS), correcto. No se activó RLS compleja en el piloto. |
| Verificación DB end-to-end pendiente | 🟡 | Falta ejecutarla contra un Supabase de staging real (runbook en §7). |

---

## 10. Siguiente paso recomendado

1. **Validar el piloto en un Supabase de staging real** siguiendo §7 (crear cliente → reiniciar → confirmar persistencia + correr la prueba de integración).
2. Si todo OK, **Fase 2 (Autenticación real)** para cerrar el hueco crítico de auth **antes** de seguir migrando dominios.
3. Luego **Fase 3**: migrar `plans` (simple) y después `billing` (con triggers de `amount_paid`), reusando este mismo patrón y resolviendo los efectos cruzados.

> **No avanzar a Fase 2 sin aprobación.**
