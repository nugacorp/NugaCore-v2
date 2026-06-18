# Arquitectura NOC Read-Only (Inventory + NOC)

> Documento de diseño. **READ ONLY estricto**: ninguna acción modifica routers reales,
> ni firewall, ni colas, ni interfaces, ni clientes. Sin commit mode, sin worker live.
> NO activa flags. Fuente de verdad: el repositorio actual. Fecha: 2026-06-18.

## Principios

1. **Solo lectura.** El NOC observa; no actúa. Cualquier escritura pertenece a fases
   posteriores (PROD-1 Manual Safe Mode → Safe Command Queue → 4.9.3 Real Provisioning).
2. **Prerequisito DB-1.** El inventario se apoya en `mikrotik_routers`; antes de
   leerlo desde DB hay que cerrar la reconciliación de schema
   (`docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`).
3. **Sanitización.** No exponer secretos ni PII innecesaria (passwords, keys, MAC, IP
   privada de cliente) en dashboards, logs ni resúmenes para agentes IA.
4. **Rate limit.** Lecturas en vivo a routers y alertas con límite de frecuencia.
5. **Degradación segura.** Si un router no responde, el NOC muestra "sin datos", nunca
   inventa ni bloquea la vista global.

## Capa 0 — Lo que ya existe en el repo (base read-only)

Endpoints actuales (`backend/domains/mikrotik/routes.ts`), todos con RBAC:

| Endpoint | Tipo | Uso NOC |
|---|---|---|
| `GET /api/mikrotik/routers` | lista | Inventory |
| `GET /api/mikrotik/routers/:id` | detalle | Inventory/NOC |
| `GET /api/mikrotik/routers/:id/health` | health | Health monitoring |
| `GET /api/mikrotik/routers/:id/read/interfaces` | read-only | Interfaces |
| `GET /api/mikrotik/routers/:id/read/queues` | read-only | Queues |
| `GET /api/mikrotik/routers/:id/read/ppp` | read-only | PPP |
| `GET /api/mikrotik/routers/:id/worker/read` | read-only | Snapshot worker |
| `GET /api/mikrotik/worker/runs` | lista | Auditoría worker |
| `GET /api/mikrotik/command-audit` | lista | Auditoría |
| `GET /api/mikrotik/logs` | lista | Logs |

Worker read-only (`backend/domains/mikrotik/worker/types.ts` → `READ_ONLY_COMMANDS`):
`/system/resource/print`, `/interface/print`, `/queue/simple/print`,
`/ppp/secret/print`, `/ppp/active/print`, `/ip/address/print`. El worker tiene modo
`simulated` (sin tocar routers) y `live` (lectura real, gated por `MIKROTIK_WORKER_LIVE`).

Stores/tipos reutilizables (`backend/state/store.ts`): `MIKROTIK_ROUTERS`, `NOC_ALERTS`
(`NocAlert`), `MIKROTIK_LOGS` (`MikrotikLog`), `TOWERS`, `OLTS`/`ONUS`/`NAP_BOXES` (FTTH),
y WireGuard peers (dominio `wireguard`).

## 1. Inventory (Read-Only)

Vista consolidada de activos de red. Fuente: `mikrotik_routers` (modelo canónico DB-1) +
`towers` + WireGuard peers.

Campos expuestos por router (saneados, vía `ProvisionedRouterView`):

- Identidad: `id`, `name`.
- Conectividad: `connectionType`, `managementIp`, `vpnIp`, `apiPort`, `apiSslPort`.
- Estado: `provisioning_status` (canónico), `isOnline`, `hasCredentials`.
- Monitoreo: `routerOsVersion`, `cpuUsagePct`, `memoryUsagePct`, `lastHealthCheckAt`, `lastSeenAt`.
- Topología: `linkedTowerId` (→ torre).
- Operación: `notes`.

NO se expone: `encrypted_password`, claves, tokens, scripts completos.

Acciones permitidas: filtrar, ordenar, ver detalle, exportar saneado. **Ninguna escritura.**

## 2. NOC Dashboard (Read-Only)

Paneles (alineados con ROADMAP §4.11):

- **Torres**: estado agregado por torre (routers online/total, alertas activas).
- **Routers**: tarjeta por router (estado, CPU, RAM, versión, última lectura).
- **WANs/Interfaces**: estado de interfaces por router (read-only).
- **Clientes**: resumen de sesiones PPP/PPPoE activas (sin PII innecesaria).
- **WireGuard peers**: peers por servidor (sin claves).

Cada panel se nutre de los endpoints read-only de la Capa 0. Sin botones de acción sobre
routers; solo navegación y detalle.

## 3. Health Monitoring (Read-Only)

Métricas por router (muestreo periódico, rate-limited):

| Métrica | Fuente RouterOS | Campo/endpoint |
|---|---|---|
| Online/offline | `/system/resource/print` (alcanzable) | `is_online`, `health` |
| CPU % | `/system/resource/print` | `cpu_usage_pct` |
| RAM % | `/system/resource/print` | `memory_usage_pct` |
| Uptime / versión | `/system/resource/print` | `routeros_version` |
| Interfaces | `/interface/print` | `/read/interfaces` |
| Queues | `/queue/simple/print` | `/read/queues` |
| PPP activos | `/ppp/active/print` | `/read/ppp` |
| Latencia/pérdida (ping) | sonda externa | `NocAlert`-like (`latencyMs`, `packetLossPct`) |

El muestreo en vivo usa el worker en modo `live` **solo lectura** (gate
`MIKROTIK_WORKER_LIVE` separado del NOC; el NOC puede operar en `simulated` o sobre el
último snapshot persistido sin live). Persistencia de muestras: `last_health_check_at` y,
a futuro, una tabla de series temporales (fuera del alcance read-only inicial).

## 4. Topología

- **Router → Torre**: `mikrotik_routers.linked_tower_id` → `towers(id)`.
- **Torre → FTTH**: `towers` ↔ `olts`/`onus`/`nap_boxes`.
- **Router → WireGuard**: peers del dominio `wireguard` (servidor único actual; ver
  `docs/WIREGUARD_SINGLE_SERVER_ARCHITECTURE.md`).
- **Cliente → Router**: sesiones PPP/PPPoE (read-only).

Render: grafo/lista jerárquica Torre → Routers → WANs/Peers → Clientes. Sin acciones de
cambio de topología (asignaciones reales son fases posteriores).

## 5. Alertas (Read-Only + notificación)

Modelo existente `NocAlert`: `id`, `source`, `sourceType` (`tower|olt|router|client`),
`severity` (`warning|critical|...`), `message`, `timestamp`, `acknowledged`.

- Generación: derivada de health (offline, CPU/RAM altas, pérdida de paquetes, PPP caído).
- Canales: Telegram / Email / Push (configurables; **secretos por nombre de variable**, no en claro).
- **Rate limit obligatorio** por fuente y severidad para evitar tormentas.
- `acknowledged` es metadato del NOC (no toca el router).
- Sanitización: los mensajes no incluyen MAC/IP privada de cliente ni secretos.

## 6. Dependencias y secuencia futura

```
DB-1 (reconciliación mikrotik_routers)
  ↓
Inventory Read-Only        (lee mikrotik_routers canónico + towers + peers)
  ↓
NOC Read-Only              (health, topología, alertas; worker read-only)
  ↓
PROD-1 Manual Safe Mode    (acciones manuales con confirmación humana)
  ↓
Safe Command Queue (dry-run)
  ↓
4.9.3 Real Provisioning    (writes reales, gated)
```

Dependencias técnicas:

- **DB-1** debe cerrarse antes de leer `mikrotik_routers` desde DB (modelo canónico).
- **Repository DB de MikroTik**: no existe aún; el dominio corre en memoria. Necesario
  antes de `USE_DB_MIKROTIK=true` (no en esta fase).
- **Worker live (lectura)**: el NOC puede arrancar en `simulated`/snapshot; el muestreo
  real requiere el gate `MIKROTIK_WORKER_LIVE` y pruebas en CHR/lab.

## Gates de seguridad (read-only)

- [ ] Ninguna ruta del NOC ejecuta escritura sobre RouterOS.
- [ ] `MIKROTIK_WORKER_LIVE=false` salvo lectura validada en CHR/lab.
- [ ] `USE_DB_MIKROTIK=false` hasta DB-1 + repository DB.
- [ ] Sin secretos en dashboards, logs ni resúmenes para IA.
- [ ] Sin MAC/IP privada de cliente en vistas públicas.
- [ ] Alertas con rate limit.
- [ ] RBAC por endpoint (ya presente en las rutas actuales).

## Resumen

El NOC Read-Only se construye sobre endpoints y tipos que **ya existen** en el repo
(lectura de routers, health, interfaces, queues, PPP, alertas). Su único bloqueador de
datos es **DB-1**: estabilizar el modelo canónico de `mikrotik_routers`. Todo lo demás es
observación sin riesgo. Nada en esta arquitectura escribe sobre routers reales.
