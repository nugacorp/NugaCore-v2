# DB-1 — Reconciliación del esquema `mikrotik_routers`

> Documento de diseño. NO ejecuta migraciones, NO toca staging/producción, NO activa
> flags, NO toca routers reales. Fuente de verdad: el repositorio actual.
> Fecha: 2026-06-18.

## Hallazgo previo (importante)

El contexto histórico (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`) describe que
`20260605000000_mikrotik_provisioning_schema.sql` **redefine** `mikrotik_routers` con un
`CREATE TABLE` que choca con `init_schema` y falla en `CREATE INDEX ... ON (status)`.

**Eso ya no es cierto en el repo actual.** La migración fue corregida a patrón evolutivo
en los commits `b4d19c4` (`fix(migrations): make staging SQL idempotent`) y `7264e59`
(`fix(migrations): make mikrotik command audit schema evolutive`). El archivo vigente:

- Hace un `CREATE TABLE IF NOT EXISTS public.mikrotik_routers (id, name, created_at)`
  **mínimo** como fallback defensivo (no redefine la tabla de monitoreo).
- Añade las columnas de provisioning con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Crea los índices **después** de garantizar las columnas (todos `IF NOT EXISTS`).

Consecuencia para DB-1: el trabajo **no** es reescribir la migración (ya es segura e
idempotente). El trabajo real es:

1. **Sellar el modelo canónico** resolviendo redundancias entre monitoreo y provisioning.
2. **Reconciliar el historial** (`supabase_migrations.schema_migrations` no registra
   `20260605000000`; lo valida y aplica Hermes, no Claude).
3. Dejar el modelo TS y los validadores alineados con el modelo canónico, **sin** activar
   `USE_DB_MIKROTIK` (todavía no existe un repository DB de MikroTik; el dominio corre en
   memoria).

---

## A. Estado actual

### Modelo A — Monitoring (`20260531000000_init_schema.sql`)

`public.mikrotik_routers` creada con:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | slug `mkt-N` |
| `name` | TEXT NOT NULL UNIQUE | nombre legible |
| `ip_address` | TEXT NOT NULL | IP de gestión (monitoreo) |
| `api_port` | INTEGER NOT NULL DEFAULT 8728 | API no-TLS |
| `username` | TEXT NOT NULL | usuario API |
| `encrypted_password` | TEXT NOT NULL | password API cifrado (AES-256-GCM) |
| `is_online` | BOOLEAN NOT NULL DEFAULT true | online en vivo |
| `cpu_usage_pct` | INTEGER NOT NULL DEFAULT 0 | CPU % |
| `memory_usage_pct` | INTEGER NOT NULL DEFAULT 0 | RAM % |
| `routeros_version` | TEXT | versión RouterOS |
| `linked_tower_id` | TEXT FK `towers(id)` ON DELETE SET NULL | torre asociada |
| `last_health_check_at` | TIMESTAMPTZ | último health check |
| `created_at` | TIMESTAMPTZ DEFAULT now() | alta |

### Modelo B — Provisioning (`20260605000000_mikrotik_provisioning_schema.sql`, evolutivo)

`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` sobre la tabla existente:

| Columna | Tipo | Notas |
|---|---|---|
| `connection_type` | TEXT NOT NULL DEFAULT 'sstp' CHECK | wireguard/sstp/direct/zerotier/tailscale |
| `management_ip` | TEXT | IP de gestión (provisioning) |
| `vpn_ip` | TEXT | IP dentro del túnel VPN |
| `api_ssl_port` | INTEGER NOT NULL DEFAULT 8729 CHECK | API TLS (preferido) |
| `status` | TEXT NOT NULL DEFAULT 'pending' CHECK | pending/provisioned/connected/error |
| `provisioning_status` | TEXT NOT NULL DEFAULT 'pending' CHECK | pending/provisioned/connected/error |
| `has_credentials` | BOOLEAN NOT NULL DEFAULT false | hay credencial cifrada |
| `last_seen_at` | TIMESTAMPTZ | última vez visto |
| `notes` | TEXT | notas libres |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | trigger `update_modified_column` |

> `linked_tower_id` y `api_port` también figuran en el `ALTER` pero ya existen por
> `init_schema`: los `ADD COLUMN IF NOT EXISTS` son no-op.

### Modelo TS (backend) — ya unificado

- `backend/state/store.ts` → `MikrotikRouterRegistryItem`: combina monitoreo (obligatorio)
  + provisioning (opcional): `connectionType?`, `managementIp?`, `vpnIp?`, `apiSslPort?`,
  `provisioningStatus?`, `notes?`, `lastSeenAt?`, `encryptionVersion?`, `credentialRotatedAt?`.
- `backend/domains/mikrotik/provisioning/types.ts` → `ProvisionedRouterView` (vista saneada
  para API/UI) y `toProvisionedView()` ya derivan `status` desde `provisioningStatus`,
  `managementIp ?? ipAddress`, `hasCredentials = !!encryptedPassword`, `apiSslPort ?? 8729`.

### Conflictos / smells detectados

1. **`status` vs `provisioning_status`**: dos columnas con el mismo dominio CHECK y default.
   Redundancia pura. El backend TS solo modela `provisioningStatus`.
2. **`ip_address` (monitoreo, NOT NULL) vs `management_ip` (provisioning)**: solapan
   conceptualmente. `toProvisionedView` usa `managementIp ?? ipAddress`.
3. **`is_online` (boolean) vs `status='connected'`**: dos formas de expresar conectividad.
4. **`last_health_check_at` (monitoreo) vs `last_seen_at` (provisioning)**: solapan.
5. **`api_port` (8728) vs `api_ssl_port` (8729)**: coexisten; el readiness checklist prefiere TLS.
6. **Drift de historial**: el schema real (staging) tiene las tablas pero
   `20260605000000` no está registrada en `schema_migrations`.

---

## B. Modelo canónico propuesto

Tabla `public.mikrotik_routers` final = **unión** de ambos modelos (ya alcanzable sin
recrear la tabla). Para cada columna: nombre · tipo · origen · motivo.

### Identidad y ciclo de vida

| Columna | Tipo | Origen | Motivo |
|---|---|---|---|
| `id` | TEXT PK | A | Identificador slug `mkt-N`. |
| `name` | TEXT NOT NULL UNIQUE | A | Nombre legible único. |
| `created_at` | TIMESTAMPTZ DEFAULT now() | A | Fecha de alta. |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | B | Última modificación (trigger). |

### Conectividad y acceso API

| Columna | Tipo | Origen | Motivo |
|---|---|---|---|
| `connection_type` | TEXT NOT NULL DEFAULT 'sstp' CHECK | B | Tipo de túnel de gestión. |
| `management_ip` | TEXT | B | **IP de gestión canónica** (preferida sobre `ip_address`). |
| `ip_address` | TEXT NOT NULL | A | IP histórica de gestión. Conservada (NOT NULL); se trata como espejo de `management_ip`. |
| `vpn_ip` | TEXT | B | IP del router dentro del túnel VPN. |
| `api_port` | INTEGER NOT NULL DEFAULT 8728 CHECK | A/B | Puerto API no-TLS. |
| `api_ssl_port` | INTEGER NOT NULL DEFAULT 8729 CHECK | B | **Puerto API TLS (preferido)**. |
| `username` | TEXT NOT NULL | A | Usuario API generado. |
| `encrypted_password` | TEXT NOT NULL | A | Password API cifrado (nunca en claro). |
| `has_credentials` | BOOLEAN NOT NULL DEFAULT false | B | Indica si hay credencial activa (derivable). |

### Estado

| Columna | Tipo | Origen | Motivo |
|---|---|---|---|
| `provisioning_status` | TEXT NOT NULL DEFAULT 'pending' CHECK | B | **Estado de provisioning CANÓNICO** (pending/provisioned/connected/error). |
| `status` | TEXT NOT NULL DEFAULT 'pending' CHECK | B | Espejo legacy de `provisioning_status`. **Deprecated** (no eliminar). |
| `is_online` | BOOLEAN NOT NULL DEFAULT true | A | Conectividad en vivo (monitoreo). |

### Monitoreo / health

| Columna | Tipo | Origen | Motivo |
|---|---|---|---|
| `cpu_usage_pct` | INTEGER NOT NULL DEFAULT 0 | A | CPU % (último muestreo). |
| `memory_usage_pct` | INTEGER NOT NULL DEFAULT 0 | A | RAM % (último muestreo). |
| `routeros_version` | TEXT | A | Versión RouterOS. |
| `last_health_check_at` | TIMESTAMPTZ | A | Último health check de monitoreo. |
| `last_seen_at` | TIMESTAMPTZ | B | Última vez visto por provisioning/worker. |

### Relaciones y metadatos

| Columna | Tipo | Origen | Motivo |
|---|---|---|---|
| `linked_tower_id` | TEXT FK `towers(id)` ON DELETE SET NULL | A | Torre asociada (topología). |
| `notes` | TEXT | B | Notas operativas libres. |

**Decisiones canónicas:**

- `provisioning_status` es la fuente de verdad de estado de provisioning; `status` queda
  como espejo deprecated (se mantiene sincronizado, nunca se elimina).
- `management_ip` es la IP de gestión canónica; `ip_address` se conserva (NOT NULL) como
  espejo para compatibilidad histórica.
- `api_ssl_port` (TLS) es el puerto preferido para el worker/conector; `api_port` se conserva.

---

## C. Compatibilidad

### Columnas que se conservan (sin cambios, NUNCA DROP)

Todas las de `init_schema`: `id`, `name`, `ip_address`, `api_port`, `username`,
`encrypted_password`, `is_online`, `cpu_usage_pct`, `memory_usage_pct`,
`routeros_version`, `linked_tower_id`, `last_health_check_at`, `created_at`.

### Columnas ya agregadas por `20260605000000` (evolutivas)

`connection_type`, `management_ip`, `vpn_ip`, `api_ssl_port`, `status`,
`provisioning_status`, `has_credentials`, `last_seen_at`, `notes`, `updated_at`.

### Columnas deprecated (conservar, no eliminar)

- `status` → usar `provisioning_status`. Se mantiene como espejo por compatibilidad.
- `ip_address` → preferir `management_ip`. Se mantiene (NOT NULL) como espejo.

> Deprecación es **soft**: la columna sigue existiendo y poblada; el código nuevo deja de
> depender de ella. Eliminación física (si alguna vez) sería una decisión futura separada,
> con backup y autorización, fuera del alcance de DB-1.

### Columnas a agregar (si se decide sellar el modelo)

Ninguna nueva es estrictamente necesaria: la unión A+B ya cubre el modelo canónico. Una
migración futura opcional solo añadiría **backfill** de espejos (ver E), nunca columnas
destructivas.

---

## D. Impacto

| Área | Impacto | Detalle |
|---|---|---|
| **Inventory (Read-Only)** | Directo | Lee `mikrotik_routers` (lista/detalle). El modelo unificado ya cubre identidad, conectividad, estado y torre. Ver `docs/NOC_READ_ONLY_ARCHITECTURE.md`. |
| **NOC (Read-Only)** | Directo | Usa `is_online`, `cpu_usage_pct`, `memory_usage_pct`, `last_health_check_at`, `routeros_version` + endpoints read-only del worker (`/read/interfaces`, `/read/queues`, `/read/ppp`). |
| **Router Enrollment** | **Nulo / desacoplado** | No depende de `mikrotik_routers` para persistencia: usa `router_snapshot` y `wireguard_snapshot` en `router_enrollment`. Aprobado en 4.9.2/4.9.2.1. La reconciliación no lo afecta. |
| **MikroTik Worker** | Indirecto | Read-only hoy (`READ_ONLY_COMMANDS`). Usa `id`, IP de gestión, `api_ssl_port`, credenciales. Requiere modelo canónico estable antes de `MIKROTIK_WORKER_LIVE`. |
| **Real Provisioning (4.9.3)** | Futuro | Necesita `provisioning_status`, `connection_type`, credenciales y auditoría persistidas. Bloqueado hasta DB-1 + repository DB + gates. |
| **Activación `USE_DB_MIKROTIK`** | Futuro | **No existe aún** un repository DB de MikroTik (el dominio corre en memoria). DB-1 NO activa el flag; solo deja el schema/modelo listos. |

---

## E. Estrategia de migración (diseño, sin ejecutar)

Reglas duras: **solo `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`**, nunca `DROP COLUMN`,
nunca recrear tablas, nunca perder datos.

### Estado de partida

`20260605000000_mikrotik_provisioning_schema.sql` **ya** implementa el patrón evolutivo y
deja el schema canónico alcanzable. No se modifica ese archivo.

### Pasos (los ejecuta Hermes en staging, no Claude)

1. **Reconciliar historial**: registrar `20260605000000` en
   `supabase_migrations.schema_migrations` (con `NOTIFY pgrst, 'reload schema';`),
   verificando primero que las columnas de provisioning existen. Si faltara alguna, el
   propio `ALTER ... ADD COLUMN IF NOT EXISTS` la crea sin riesgo.
2. **(Opcional) Migración de sellado** `2026XXXXXXXXXX_mikrotik_routers_canonical.sql`,
   solo si se quiere formalizar los espejos. Contenido permitido:
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para cualquier columna canónica faltante.
   - Backfill idempotente y guardado, p. ej.:
     - `UPDATE ... SET management_ip = ip_address WHERE management_ip IS NULL;`
     - `UPDATE ... SET provisioning_status = status WHERE provisioning_status = 'pending' AND status <> 'pending';`
   - `NOTIFY pgrst, 'reload schema';`
   - **Prohibido**: `DROP COLUMN`, `ALTER COLUMN ... TYPE` destructivo, `RENAME`, recrear tabla.
3. **Validadores**: extender `scripts/validate-staging-migrations.mjs` para verificar el
   conjunto canónico de columnas (ya cubre las de provisioning) y los espejos.
4. **Tests unitarios** de la migración (estructura/idempotencia) en
   `tests/unit/staging.migrations.test.ts`.

> Ninguno de estos pasos se ejecuta en esta sesión. Aplicación y validación staging son
> responsabilidad de Hermes, con autorización explícita.

---

## F. Riesgos

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | Redundancia `status` / `provisioning_status` deriva en inconsistencia. | Media | Designar `provisioning_status` canónico; backfill de espejo; el repository DB futuro escribe ambos. |
| R2 | `ip_address` NOT NULL obliga valor aunque se prefiera `management_ip`. | Baja | Mantener `ip_address` como espejo poblado desde `management_ip`. No se elimina. |
| R3 | Drift historial vs schema (`20260605000000` no registrada). | Media | Reconciliar historial (paso E.1) como hizo `SUPABASE_MIGRATIONS_SYNC.md` con otras migraciones. |
| R4 | Activar `USE_DB_MIKROTIK` sin repository DB rompe el dominio. | **Alta** | DB-1 NO activa el flag. El repository DB es trabajo posterior y separado. |
| R5 | Backfill futuro viola un CHECK si hay datos legacy fuera de dominio. | Baja | Backfill guardado con `WHERE`; valores legacy ya cumplen el default del CHECK. |
| R6 | La doc `SUPABASE_MIGRATIONS_SYNC.md` describe el conflicto antiguo (desactualizada). | Baja | Este documento aclara el estado real; actualizar la nota de conflicto cuando Hermes registre la migración. |
| R7 | El backend TS no modela `status` separado; un repository DB descuidado podría desincronizar. | Media | El repository DB debe mapear `provisioningStatus` → ambas columnas y leer desde `provisioning_status`. |

---

## Resumen ejecutivo

- La migración de provisioning **ya es evolutiva**; no hay que reescribirla.
- El modelo canónico = unión monitoreo + provisioning, **ya alcanzable sin recrear la tabla**.
- DB-1 se reduce a: sellar decisiones canónicas (espejos `status`/`provisioning_status` e
  `ip_address`/`management_ip`), reconciliar el historial y alinear validadores/tests.
- **No** se activa `USE_DB_MIKROTIK`, **no** se aplican migraciones desde Claude, **no** se
  tocan routers reales. La aplicación/validación en staging es de Hermes.
- Siguiente paso operativo tras DB-1: Inventory Read-Only (ver
  `docs/NOC_READ_ONLY_ARCHITECTURE.md`).
