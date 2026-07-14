# NugaCore — Análisis de Base de Datos (DATABASE_ANALYSIS)

> Última actualización: 2026-06-01
> Relacionado: [DATA_CONTRACT.md](./DATA_CONTRACT.md) (contrato ratificado) · esquema en `supabase/migrations/`.

---

## 0. Estado actual en una frase

> El esquema PostgreSQL **ya está diseñado y alineado al frontend** (`20260531000000_init_schema.sql`, 634 líneas) y las **RLS + seeds** existen (`20260531000001_rls_and_seeds.sql`, sin commitear aún). **Pero la base de datos no está conectada**: el backend sigue leyendo/escribiendo el store en memoria. No existe la capa repository que una ambos mundos.

---

## 1. Inventario de tablas (esquema actual)

El esquema cubre 14 áreas. Tablas existentes (`public.*`):

### IAM (UUID, atado a Supabase Auth)
- `users_profile`, `roles`, `permissions`, `user_roles`, `role_permissions`

### Negocio (PK TEXT/slug)
| Área | Tablas |
|------|--------|
| Planes | `plans` (incluye `tech_type` + `business_type` + `is_active`) |
| Clientes | `clients`, `client_documents`, `client_timeline` |
| Facturación | `invoices`, `invoice_items`, `invoice_payments` |
| Red física | `towers`, `network_sectors` |
| FTTH | `olts`, `onus`, `nap_boxes`, `nap_ports` |
| MikroTik | `mikrotik_routers`, `mikrotik_command_audit` |
| Soporte | `tickets`, `ticket_messages`, `ticket_attachments`, `ticket_history`, `work_orders`, `work_order_evidences`, `work_order_history` |
| Inventario | `inventory_items`, `inventory_item_states`, `inventory_movements`, `inventory_assignments` |
| Monitoreo | `monitoring_snapshots`, `noc_alerts` |
| Suspensión/Autom. | `suspension_policy`, `suspension_action_logs`, `automation_rules` |
| Seguridad | `audit_logs` (cambios de datos), `security_audit_logs` (accesos HTTP) |
| Config singletons | `notification_settings`, `backup_policy` |

**Enums** (en inglés, 20+): `client_status`, `client_type`, `connection_type`, `plan_tech_type`, `plan_business_type`, `invoice_status`, `cfdi_status`, `payment_method`, `device_status`, `olt_status`, `onu_status`, `ticket_severity`, `ticket_status`, `work_order_type`, `work_order_status`, `inventory_category`, `equipment_operational_status`, `monitoring_status`, `alert_source_type`, `alert_severity`.

---

## 2. Relaciones (modelo entidad-relación resumido)

```
auth.users ──1:1── users_profile ──M:N(user_roles)── roles ──M:N(role_permissions)── permissions

plans ──1:N── clients ──1:N── client_documents
                  │            client_timeline
                  ├──1:N── invoices ──1:N── invoice_items
                  │                   └─1:N── invoice_payments
                  ├──1:N── onus
                  ├──1:N── tickets ──1:N── ticket_messages / attachments / history
                  ├──1:N── work_orders ──1:N── evidences / history
                  └──1:N── suspension_action_logs

towers ──1:N── network_sectors
       └──1:N── mikrotik_routers (linked_tower_id)
olts  ──1:N── onus
nap_boxes ──1:N── nap_ports

inventory_items ──1:1── inventory_item_states
                ├──1:N── inventory_movements
                └──1:N── inventory_assignments
```

**Integridad referencial** definida con `ON DELETE CASCADE` (hijos de cliente/factura/ticket/orden) y `ON DELETE SET NULL` (referencias opcionales: `plan_id`, `olt_id`, `client_id` en onus, `linked_tower_id`). Buen diseño.

---

## 3. Problemas detectados

### 3.1 La DB no está conectada (🔴 bloqueante)
- Toda lectura/escritura ocurre en `store.*`. El esquema es "teórico" hasta que exista la capa repository.
- No hay generación de tipos desde la DB ni cliente tipado de datos (solo `supabaseAdmin` para auth).

### 3.2 Telemetría no persistida (decisión, no bug)
- `towers` no guarda `cpu/ram/temp/ping/uptime/ports`. El frontend (`Tower`) sí los modela. Sin pipeline de monitoreo real, esos campos quedarían vacíos al migrar → la UI debe tolerar `null` o calcularlos de `monitoring_snapshots`.

### 3.3 Doble fuente de verdad en inventario
- `inventory_items.qty` vs `inventory_movements`. No hay trigger que reconcilie; el conteo puede divergir.

### 3.4 Lecturas con efectos secundarios (en el backend actual)
- `GET /api/billing/invoices` muta estados (`syncInvoiceStatus`). Al migrar a DB, esto debe convertirse en un `UPDATE` explícito o en un campo calculado/`generated`, no en un side-effect de lectura.

### 3.5 `client_name`/`item_name` denormalizados
- `invoices.client_name`, `onus.client_name`, `work_orders.client_name`, `inventory_movements.item_name` se duplican. Aceptable por rendimiento/historial, pero requieren sincronización al renombrar la entidad madre.

### 3.6 IDs generados en memoria
- `getUnique*Id()` calcula el siguiente slug escaneando el arreglo. En DB concurrente esto produce **race conditions**. Debe sustituirse por secuencias, `gen_random_uuid()` para slugs internos, o un generador transaccional.

### 3.7 `nap_id`/`nap_port` en `onus` sin FK
- `onus.nap_id` es TEXT libre, no referencia a `nap_boxes`. Falta FK para integridad.

---

## 4. Índices

### Existentes (16)
`clients(status)`, `clients(plan_id)`, `client_timeline(client_id)`, `invoices(client_id)`, `invoices(status)`, `invoice_payments(invoice_id)`, `network_sectors(tower_id)`, `onus(client_id)`, `onus(olt_id)`, `tickets(client_id)`, `tickets(status)`, `work_orders(client_id)`, `security_audit_logs(created_at)`, `audit_logs(entity_type, entity_id)`.

### Faltantes recomendados
| Tabla | Índice sugerido | Razón |
|-------|-----------------|-------|
| `invoices` | `(due_date)` | Escaneo de vencidas (suspensión/cobranza) |
| `invoices` | `(status, due_date)` | Filtro compuesto de cartera |
| `clients` | `(city)`, `(type)` | Filtros de CRM ya soportados en API |
| `clients` | trigram/`GIN` en `full_name`,`email` | Búsqueda `q` (ILIKE) |
| `onus` | `(nap_id)` | Ocupación de NAP |
| `ticket_messages` | `(ticket_id)` | Hilo de ticket |
| `work_orders` | `(status)`, `(date)` | Agenda y tablero |
| `suspension_action_logs` | `(client_id)`, `(created_at)` | Bitácora por cliente |
| `mikrotik_command_audit` | `(router_id, created_at)` | Auditoría por router |
| `monitoring_snapshots` | `(target_id, created_at)` | Series temporales |
| `inventory_movements` | `(item_id, created_at)` | Kardex |

---

## 5. Normalización

- **Bien normalizado** en general (3FN): items, pagos, mensajes y evidencias en tablas hijas.
- **JSONB usado pragmáticamente** para listas no consultables individualmente: `towers.equipment`, `olts.splitters`, `work_orders.checklist`, `inventory_items.serials`, `clients.installation_photos`. Razonable; vigilar si en el futuro se requiere consultar dentro (ej. buscar por serial → conviene tabla `inventory_serials`).
- **Denormalización controlada** de `*_name` (ver §3.5).

---

## 6. Escalabilidad

| Aspecto | Evaluación | Acción |
|---------|-----------|--------|
| Volumen esperado (un WISP regional) | Decenas de miles de clientes/facturas | PostgreSQL sobra; índices correctos bastan |
| `monitoring_snapshots` | Crece sin límite (series temporales) | Particionar por fecha o TTL/retención; o tabla aparte (TimescaleDB/rollups) |
| `security_audit_logs` / `audit_logs` | Crecimiento alto | Retención + particionado por mes; archivar |
| Generación de IDs | Race conditions al escalar | Secuencias / generador transaccional |
| Multi-instancia API | Store en memoria rompe coherencia | La DB resuelve esto (otra razón para migrar ya) |
| `TEXT` PK vs UUID | Sin penalización relevante a esta escala | OK (decisión ratificada) |

---

## 7. Modelo ideal por entidad (validación de las 10 solicitadas)

> El esquema actual **ya implementa** un modelo cercano al ideal. Aquí se confirma y se afinan detalles.

### `customers` → `clients` ✅
PK `TEXT`, enums `client_status`/`client_type`/`connection_type`, FK `plan_id`. **Afinar:** índices `(city)`, `(type)`, búsqueda trigram; mover documentos/fotos a Storage con referencia.

### `plans` ✅
Separa `tech_type` (PPPoE/…) de `business_type` (Residencial/…) + `is_active`. Correcto (resuelve el conflicto histórico de `type`).

### `invoices` (+ `invoice_items`, `invoice_payments`) ✅
`amount`, `amount_paid`, `status`, `cfdi_*`. **Afinar:** `amount_paid` debe mantenerse por trigger desde `invoice_payments` (hoy lo calcula el backend); índice `(due_date)`.

### `payments` → `invoice_payments` ✅
Con `method` (enum), `transaction_id`. **Afinar:** para conciliación de pasarela, añadir `gateway`, `gateway_payment_id`, `status` del pago.

### `towers` ✅ (config) + telemetría fuera
Persistir solo config; telemetría desde `monitoring_snapshots`. **Afinar:** tabla `tower_telemetry` opcional si se requiere histórico fino.

### `network_devices` → repartido en `mikrotik_routers` + `network_sectors` + equipo JSONB
**Observación:** no hay una tabla genérica `network_devices`; los equipos viven como JSONB en `towers.equipment` y como `mikrotik_routers`. Si se quiere inventario de red unificado, considerar tabla `network_devices` (id, tipo, marca, modelo, ip, tower_id, status) — **decisión de diseño futura**.

### `tickets` ✅ (+ messages/attachments/history)
Alineado a 4 estados del frontend. **Afinar:** índice `(status)` ya existe; añadir `(technician_id)`, `(severity)`.

### `inventory` → `inventory_items` (+ states/movements/assignments) ✅
**Afinar:** trigger de reconciliación `qty` ↔ movements; tabla de seriales si se rastrea por unidad.

### `mikrotik_routers` ✅
`encrypted_password`, `memory_usage_pct` (porcentaje, alineado al store), `linked_tower_id`, `last_health_check_at`. Correcto.

### `audit_logs` ✅ + `security_audit_logs` ✅
Dos modelos intencionales (cambios de datos vs accesos HTTP). **Afinar:** retención/particionado.

---

## 8. RLS y seguridad de datos

- `20260531000001_rls_and_seeds.sql` habilita **RLS en todas las tablas sin políticas permisivas** → `anon`/`authenticated` no pueden leer/escribir nada. Defensa en profundidad correcta: si filtra la anon key, la DB queda sellada.
- **Toda autorización real la hace Express** (RBAC) usando la **service-role key** (bypassa RLS).
- ⚠️ **Riesgo:** la service-role key es total; debe vivir solo en el backend, nunca en el cliente, y rotarse. Si se quiere acceso directo frontend→Supabase para alguna tabla, habrá que escribir políticas explícitas.
- **Admin user**: no se puede sembrar por SQL (Supabase Auth posee `auth.users`); el archivo documenta el paso manual.

---

## 9. Pasos para conectar la DB (orden recomendado)

1. Aplicar ambas migraciones a un proyecto Supabase de staging.
2. Generar tipos (o escribir mappers manuales `snake_case` ↔ `camelCase` según el contrato).
3. Crear `repository.ts` por dominio; **empezar por Clientes** (piloto).
4. Feature flag `USE_DB_CLIENTS` para alternar store↔DB sin big-bang.
5. Reemplazar `getUnique*Id()` por generación transaccional.
6. Mover side-effects de lectura (billing) a writes explícitos o columnas generadas.
7. Añadir triggers de reconciliación (factura `amount_paid`, inventario `qty`).
8. Migrar el resto de dominios siguiendo el orden de [MASTER_BACKLOG.md](../planning/MASTER_BACKLOG.md).
9. Definir retención/particionado para tablas de series y auditoría.
