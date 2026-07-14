# NugaCore — Contrato de Datos (v1)

> Estado: **RATIFICADO** (decisiones §3 y §5.1 aprobadas 2026-06-01). El esquema `supabase/migrations/20260531000000_init_schema.sql` ya fue realineado a este contrato.
> Última actualización: 2026-06-01
>
> **Decisiones tomadas:**
> - §3 IDs → **TEXT/slug** para entidades de negocio; **UUID** para IAM (atado a `auth.users`).
> - §5.1 Enums → **valores en inglés** en la DB, igual que el frontend (el español es solo etiqueta visual).
> - Nota de implementación: `AutomationRule.trigger` se mapea a la columna `trigger_type` (`trigger` es palabra reservada en Postgres).

## 1. Principio rector

El **frontend es la fuente de verdad**. Los tipos de `src/types.ts` definen el contrato visual y **no se modifican** sin autorización. Todo lo demás (base de datos, capa de acceso, integraciones) se adapta a ellos.

Consecuencia directa: el esquema SQL actual (`supabase/migrations/20260531000000_init_schema.sql`) fue escrito como un modelo "ideal v2.4" **independiente** del frontend real y **diverge en casi todas las entidades**. Hay que realinearlo, no al revés.

## 2. Convenciones

| Capa | Estilo de nombres | Vocabulario de estados | IDs |
|------|-------------------|------------------------|-----|
| Frontend / API (`src/types.ts`) | `camelCase` | inglés (`active`, `open`, `paid`) | `string` opaco |
| Base de datos (Postgres) | `snake_case` | **igual al frontend** (en inglés) | ver §3 |
| Capa repository (a crear) | traduce `snake_case` ↔ `camelCase` | sin traducción de valores | — |

**Regla:** la traducción `snake_case` ↔ `camelCase` ocurre **solo** en los mapeadores del repository. Los valores de enum **no se traducen** (la DB guarda `active`, no `Activo`). Esto elimina la clase de bug "tres vocabularios distintos" que existe hoy.

## 3. Estrategia de IDs ⚠️ (decisión recomendada)

El frontend usa IDs de texto semánticos (`plan-basic`, `c-1`, `fac-101`, `olt-1`) y los hardcodea como *fallback* en:
- `src/components/CrmModule.tsx:69,97` → `plans[0]?.id || 'plan-basic'`
- `src/components/NetworkModule.tsx:82` → `olts[0]?.id || 'olt-1'`

**Recomendación:**
- **IAM** (`users_profile`, ligado a `auth.users`): **UUID** — lo impone Supabase Auth.
- **Entidades de negocio** (clients, plans, invoices, tickets, towers, …): **`TEXT` como PK**, preservando los slugs actuales.

Razón: usar UUID obligaría a re-sembrar y a garantizar que ningún componente dependa del fallback; `TEXT` PK conserva 100% de compatibilidad con el frontend y hace la migración de datos trivial. Postgres maneja `TEXT` PK sin penalización relevante a esta escala.

> Alternativa si se prefiere el estándar Supabase (UUID en todo): viable, pero exige sembrar `plans` con esos slugs como `slug` único y refactorizar los 3 fallbacks. Decisión tuya.

## 4. Mapeo por entidad (app ↔ DB)

Leyenda: ✅ coincide · ✏️ renombrar · ➕ falta en DB · ➖ falta en frontend (campo nuevo del brief, se añade NULLABLE) · ⚠️ conflicto de valores.

### 4.1 Plan ↔ `plans`
| App (`Plan`) | DB actual | Acción |
|---|---|---|
| `id` | `id UUID` | ✏️ → `TEXT` |
| `name` | `name` | ✅ |
| `speedMbpsDown` | `speed_down_mbps` | ✏️ |
| `speedMbpsUp` | `speed_up_mbps` | ✏️ |
| `price` | `price` | ✅ |
| `type: PPPoE/Hotspot/DHCP/Static` | `type: Residencial/Empresarial/Dedicado` | ⚠️ **Significan cosas distintas**: el frontend `type` = método técnico; el negocio (Residencial/…) vive en `PLAN_METADATA.businessType`. → DB necesita **dos columnas**: `tech_type` (PPPoE/…) y `business_type` (Residencial/…). |
| `PLAN_METADATA.businessType` | (parte de `plans`) | ➕ `business_type` |
| `PLAN_METADATA.isActive` | `is_active` | ✅ |

### 4.2 Client ↔ `clients`
| App (`Client`) | DB actual | Acción |
|---|---|---|
| `id` | `id UUID` | ✏️ → `TEXT` |
| `name` | `full_name` | ✏️ |
| `type: residential/corporate/government/hotel/school` | (sin columna) | ➕ enum `client_type` |
| `status: active/suspended/lead/baja` | `status: Prospecto/Activo/Suspendido/Cancelado/Moroso` | ⚠️ Ver §5.1 |
| `email`,`phone`,`address`,`city`,`lat`,`lng`,`notes` | iguales | ✅ |
| `connectionType: WISP/FTTH` | `connection_type` NOT NULL | ✏️ + hacer NULLABLE (en app es opcional) |
| `planId` | `plan_id` | ✏️ |
| `ip` | `ip_assigned` | ✏️ |
| `mac` | `mac_address` | ✏️ |
| `pppoeUser`/`pppoePassword` | `ppp_user`/`ppp_password` | ✏️ |
| `contractId` | (sin columna) | ➕ `contract_id` |
| `documents[]` | `client_documents` (tabla) | ✅ tabla aparte |
| `installationPhotos[]` | (sin columna) | ➕ `installation_photos JSONB` |
| `installationDate` | `installation_date` | ✏️ |
| — | `whatsapp` | ➖ campo del brief, mantener NULLABLE |
| — | `colonia` | ➖ campo del brief, mantener NULLABLE |

### 4.3 Invoice ↔ `invoices` (+ `invoice_payments`)
| App (`Invoice`) | DB actual | Acción |
|---|---|---|
| `id` | `id UUID` | ✏️ → `TEXT` |
| `clientId`/`clientName` | `client_id` / (sin) | ✏️; `clientName` se resuelve por join o se desnormaliza |
| `amount` | `amount_due` | ✏️ (DB además tiene subtotal/tax/amount_paid: OK, son extra) |
| `dateStr`/`dueDateStr` | `issue_date`/`due_date` | ✏️ (DB usa DATE; app usa string ISO) |
| `status: paid/unpaid/overdue/canceled` | `status: Pendiente/Pagado/Parcial/Vencido/Cancelado` | ⚠️ Ver §5.1 |
| `cfdiStatus`/`cfdiUuid` | (sin columnas) | ➕ `cfdi_status`, `cfdi_uuid` (facturación MX) |
| `items[]` | (sin tabla) | ➕ `invoice_items` o `items JSONB` |
| `payments[]` | `invoice_payments` (tabla) | ✅ normalizado |

### 4.4 Ticket ↔ `tickets`
| App (`Ticket`) | DB actual | Acción |
|---|---|---|
| `severity: low/medium/high/critical` | `Baja/Media/Alta/Crítica` | ⚠️ §5.1 |
| `status: open/assigned/resolved/closed` (4) | `Abierto/En proceso/En espera/Resuelto/Cerrado` (5) | ⚠️ El frontend solo modela 4 estados. Alinear DB a los 4 del frontend o el UI no podrá representar "En proceso"/"En espera". |
| `category: Internet/Facturacion/...` | `category TEXT` | ✅ libre |
| `messages[]` | (sin tabla) | ➕ `ticket_messages` |
| `attachments[]`,`history[]` | (sin tablas) | ➕ |
| `slaHours` | `slam_hours` | ✏️ (typo en DB: `slam`→`sla`) |

### 4.5 WorkOrder ↔ `work_orders`
| App (`TaskOrder`) | DB actual | Acción |
|---|---|---|
| `type: installation/repair/migration/reallocation` (4) | `installation/revision/equipment_change/reallocation/retirement/maintenance` (6) | ⚠️ Conjuntos distintos. El frontend usa `repair`/`migration` que la DB no tiene. Alinear al frontend (o ampliar frontend, requiere autorización visual). |
| `status: pending/in_progress/completed/canceled` | `pending/in_progress/completed/cancelled` | ⚠️ **`canceled` (app, 1 L) vs `cancelled` (DB, 2 L)** — bug clásico, unificar a la grafía del frontend (`canceled`). |
| `checklist`,`photos`,`signature` | `checklist`,`photos_before/after`,`customer_signature_url` JSONB | ✏️ el app tiene un solo `photos[]`; la DB separa before/after |

### 4.6 Tower / Sector ↔ `towers` / `sectors`
- `Tower` (frontend) mezcla **config persistente** (height, ip, equipment) con **telemetría en vivo** (cpu, ram, tempCelsius, pingMs, uptime, ports[]). La DB solo modela config. → La telemetría **no se persiste** como columnas; viene de monitoreo (§4.9) o se calcula. Persistir solo: `name, status, lat, lng, height, ip, coverageRadiusKm, equipment(JSONB)`.
- `NetworkSector` (store: `azimuth`, `clientsCount`) vs `sectors` (DB: `frequency`, `channel_width`, `ip_address`, `ssid`, `technology`, `device_brand`). ⚠️ Modelos casi disjuntos → unificar al superset que use el componente `NetworkModule`.

### 4.7 OLT / ONU / NAP
- `olts`: existe en DB pero le faltan `onus_connected`, `onus_limit`, `splitters[]` del frontend. ➕
- **`onus` y `naps`/`nap_ports`: NO existen en el SQL** aunque el frontend los usa intensamente (`OnuFTTH`, `NapBox`, `NapPort`). ➕➕ Tablas faltantes completas.

### 4.8 Inventory ↔ `inventory_items` (+ estados/movimientos)
| App | DB actual | Acción |
|---|---|---|
| `WarehouseItem.qty` | `quantity` | ✏️ |
| `category: CPE/Router/Switch/Antenna/Fiber/OLT/Other` | `category TEXT` | ✅ |
| `warehouse: Principal/Torre Alfa/...` | `warehouse_name` | ✏️ |
| `serials[]` | (sin columna) | ➕ `serials JSONB` |
| `INVENTORY_ITEM_STATES` | (parte de `inventory_items.status`) | ➕ separar o columna `operational_status` |
| `INVENTORY_MOVEMENTS` | (sin tabla) | ➕ `inventory_movements` |
| `INVENTORY_ASSIGNMENTS` | (sin tabla) | ➕ `inventory_assignments` |

### 4.9 Resto (faltan en SQL por completo)
`mikrotik_routers` existe pero ⚠️ usa `memory_free_mb` mientras el store usa `memoryUsagePct` (porcentaje ≠ MB) y le faltan `linked_tower_id`, `last_health_check_at`.
Faltan tablas para: `mikrotik_command_audit`, `network_sectors`, `suspension_policy` + `suspension_action_logs`, `automation_rules`, `monitoring_snapshots`, `notification_settings`, `backup_policy`, `client_timeline` (existe ✅).

### 4.10 Auditoría ⚠️ (conflicto de diseño)
Dos modelos incompatibles conviven:
- **DB `audit_logs`**: audita **cambios de entidad** (`entity_type`, `entity_id`, `old_value`, `new_value`).
- **Store `SecurityAuditLog`**: audita **requests HTTP** (`resource`, `method`, `statusCode`, `success`, `source`).

Decisión: son **dos cosas distintas y ambas útiles** → mantener `audit_logs` (cambios de datos) **y** crear `security_audit_logs` (accesos HTTP). No fusionar.

## 5. Decisiones que bloquean el realineado ⚠️

### 5.1 Idioma de los enums de estado
El frontend usa **inglés** (`active`, `open`, `paid`, `overdue`). El SQL y tu brief usan **español** (`Activo`, `Abierto`, `Pagado`, `Vencido`).

Como el frontend no se toca, la app **debe** operar en inglés. Dos caminos:
- **(A) Recomendado:** DB guarda los valores **en inglés** (igual que el frontend). El español queda solo como *etiqueta de presentación* (ya lo hace el UI). Cero mapeo de valores, cero bugs.
- **(B)** DB en español + mapeo de valores en el repository. Más frágil; un valor nuevo olvidado rompe en silencio.

### 5.2 "Moroso" no existe como estado de cliente en el frontend
El frontend modela 4 estados (`active/suspended/lead/baja`); "moroso" se deriva de tener facturas `overdue`, no es un `status`. El brief y el SQL lo tratan como estado. → Mantener "moroso" como **derivado** (cliente activo con factura vencida), no como columna, para no alterar el UI.

## 6. Próximos pasos (tras aprobar este contrato)
1. **Realinear** `init_schema.sql` según §4 (Tarea #2).
2. **RLS + seeds** (Tarea #3): habilitar Row Level Security en todas las tablas (hoy hay **0 políticas**) + sembrar roles/permisos/planes/admin.
3. Crear la **capa repository** con mapeadores `snake_case`↔`camelCase` (un dominio piloto: Clientes).
4. Migrar dominio por dominio del store en memoria a Supabase, preservando el contrato de API v1.

## 7. Riesgos abiertos
- Sin §5.1 resuelto, cualquier migración a DB falla en silencio por desajuste de enums.
- Sin RLS, conectar el frontend con la `anon key` expone toda la base.
- IDs `TEXT` vs UUID condiciona todas las FKs: decidir antes de escribir el SQL.
