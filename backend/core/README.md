# backend/core — Capa Repository / Service

> Andamiaje creado en **Fase 0**. Define el patrón de capas que se usará en **Fase 1+**
> para migrar del store en memoria a la base de datos **sin romper el contrato de API v1**.
> En Fase 0 estas piezas existen pero **no están cableadas** a las rutas actuales.

## Objetivo

Separar responsabilidades que hoy están mezcladas dentro de `domains/*/routes.ts`:

```
routes.ts    → HTTP + RBAC (Express)         [ya existe]
service.ts   → reglas de negocio              [se crea por dominio en Fase 1]
repository.ts→ acceso a datos (interfaz)      [core/repository.ts]
mappers.ts   → DB row ↔ tipo de src/types     [se crea por dominio en Fase 1]
```

La ruta llama al **service**; el service usa un **repository** (interfaz); el repository
concreto puede ser en memoria (hoy) o Supabase (mañana). La ruta y el service no cambian
cuando se cambia la fuente de datos.

## Piezas

| Archivo | Qué es |
|---------|--------|
| `repository.ts` | Interfaz `Repository<T, ID>` (list/findById/create/update/remove) + `ListQuery`. |
| `in-memory-repository.ts` | `InMemoryRepository<T>`: implementa la interfaz sobre un arreglo (puente desde el `store`). |
| `service.ts` | `DomainService<T>`: base mínima que envuelve un repository. |
| `index.ts` | Barrel de exportación. |

## Patrón de migración (Fase 1, por dominio)

```ts
// 1) Repo en memoria (envuelve el store, mismo contrato)
const clientsStoreRepo = new InMemoryRepository(store.CLIENTS);

// 2) (Fase 1) Repo de Supabase con la MISMA interfaz
//    class ClientsSupabaseRepository implements Repository<Client> { ... }

// 3) Selección por feature flag (backend/config/feature-flags.ts)
import { isDomainOnDb } from '../config/feature-flags';
const clientsRepo = isDomainOnDb('clients') ? clientsSupabaseRepo : clientsStoreRepo;

// 4) El service usa `clientsRepo`; la ruta usa el service. Contrato intacto.
```

## Reglas

- El **service nunca importa Express** (sin `req`/`res`): es lógica pura y testeable.
- La traducción `snake_case` ↔ `camelCase` ocurre **solo** en los mappers del repository
  (ver [../../docs/DATA_CONTRACT.md](../../docs/DATA_CONTRACT.md)). Los valores de enum **no se traducen**.
- Migrar **un dominio a la vez**, detrás de su flag `USE_DB_<DOMINIO>`, validando con las
  pruebas de contrato (`tests/contract/`).
