# NOC Real Telemetry (Fase 4.11.3) — Resultado de implementación

> Estado: **implementada localmente** (pendiente validación staging por Hermes).
> READ-ONLY estricto. NO activa flags peligrosos, NO ejecuta RouterOS, NO escribe,
> NO envía notificaciones, NO encola comandos, NO aplica migraciones.
> Fecha: 2026-06-20.

## 1. Alcance

Fase 4.11.3 agrega **observabilidad** sobre el NOC read-only existente (4.11.2),
derivada de datos ya disponibles en memoria (`backend/state/store.ts`): salud
agregada de routers, telemetría por torre y panel de alertas derivadas. No
introduce DB nueva, ni worker live, ni acciones.

Construida sobre la base aprobada en 4.11.2 (`docs/NOC_READ_ONLY_STAGING_RESULT.md`)
y la arquitectura de `docs/NOC_READ_ONLY_ARCHITECTURE.md` (capa 0 read-only).

## 2. Arquitectura

```
store.MIKROTIK_ROUTERS  ─┐
store.TOWERS  ───────────┤→ noc-telemetry/service → mappers (puros) → JSON read-only
noc/repository (routers) ─┘        │
noc/mappers (healthStatus, staleness, umbrales)  ← reutilizado (criterio único)
```

- **Dominio nuevo:** `backend/domains/noc-telemetry/` (`types.ts`, `mappers.ts`,
  `service.ts`, `routes.ts`).
- **Reutilización deliberada:** la clasificación de salud (`resolveHealthStatus`,
  `resolveReferenceTimestampMs`, umbrales CPU/RAM 85/95, staleness 30 min) se importa
  del dominio `noc` (4.11.2) para garantizar **un único criterio** healthy/warning/critical.
- **Fuente de routers:** `nocReadOnlyRepository.listRouters()` (mismo store, sin DB).
- **Fuente de torres:** `store.TOWERS` (catálogo en memoria).

### Decisión de diseño: alerts no se duplica

La TAREA 2 listaba `GET /api/noc/alerts`, pero ese endpoint **ya existe y fue
aprobado en 4.11.2** (dominio `noc`), con la tipología exacta requerida
(`router_offline`, `high_cpu`, `high_memory`, `health_stale`). Registrar la misma
ruta otra vez sería una colisión de routing en Express. Por eso 4.11.3 **reutiliza**
el endpoint existente y solo agrega `/api/noc/health` y `/api/noc/towers`. El panel
de alertas del nuevo módulo consume `/api/noc/alerts` sin redefinirlo.

### Cambio aditivo en 4.11.2 (backward-compatible)

`NocRouterView` (dominio `noc`) recibió dos campos **opcionales**: `towerId?` y
`towerName?`, poblados en `noc/service.listRouters()` desde `store.TOWERS`. Es
aditivo (no rompe el contrato aprobado: no quita campos, no expone secretos) y
permite a la tabla per-router del frontend mostrar la columna "Torre". Los tests de
contrato de 4.11.2 siguen verdes.

## 3. Endpoints

Todos READ-ONLY, mismo RBAC que 4.11.2 (`NOC_READ_ROLES`); Cobranza excluido.

| Método | Endpoint | Fase | Payload |
|---|---|---|---|
| GET | `/api/noc/health` | 4.11.3 (nuevo) | `NocHealthSummary` (objeto) |
| GET | `/api/noc/towers` | 4.11.3 (nuevo) | `NocTowerTelemetry[]` |
| GET | `/api/noc/alerts` | 4.11.2 (reutilizado) | `NocDerivedAlert[]` |
| GET | `/api/noc/routers` | 4.11.2 (enriquecido con torre) | `NocRouterView[]` |

### Payloads

`GET /api/noc/health`:

```json
{
  "totalRouters": 4,
  "onlineRouters": 3,
  "offlineRouters": 1,
  "warningRouters": 1,
  "criticalRouters": 2
}
```

- `online/offline` se cuentan por conectividad (`isOnline`).
- `warning/critical` se cuentan por `healthStatus` derivado (umbrales + staleness).
- Un router offline cuenta como `offline` **y** como `critical` (dimensiones
  distintas, pueden solaparse). Con 0 routers devuelve todos los contadores en 0.

`GET /api/noc/towers`:

```json
[
  { "towerId": "t-1", "towerName": "Torre del Valle (Norte)",
    "totalRouters": 2, "online": 2, "offline": 0, "warning": 1, "critical": 0 }
]
```

- Agregado por `linkedTowerId`. Routers sin torre caen al bucket
  `{ towerId: "unassigned", towerName: "Sin torre asignada" }`.
- Solo aparecen torres con al menos un router; torres sin routers no generan fila.
- Orden estable por `towerName`. Con 0 routers devuelve `[]`.

## 4. UI

`src/components/NocTelemetryModule.tsx`, integrado en App bajo el tab `noc`
(debajo de `NocReadOnlyModule`):

- **Widgets:** Routers Online, Routers Offline, Warnings, Critical, Torres monitoreadas.
- **Tabla por router:** Router (+ badge de salud), Torre, Estado, CPU, RAM, Último check.
- **Tabla por torre:** Torre, Routers, Online, Offline, Warning, Critical.
- **Panel de alertas derivadas** con severidad.
- **Badge `READ-ONLY`** y texto visible: *"Esta vista no ejecuta acciones ni modifica routers."*
- **Empty states** para routers y alertas.
- Solo `fetch` GET; sin `method: POST/PUT/PATCH/DELETE`.

## 5. RBAC

Igual que 4.11.2:

| Rol | health | towers | alerts |
|---|---|---|---|
| Super Admin | 200 | 200 | 200 |
| Administrador | 200 | 200 | 200 |
| Técnico | 200 | 200 | 200 |
| Soporte | 200 | 200 | 200 |
| Solo lectura | 200 | 200 | 200 |
| Cobranza | 403 | 403 | 403 |

Visibilidad frontend vía el tab `noc` existente en `src/lib/rbac.ts` (Cobranza no lo ve).

## 6. Tests

- `tests/contract/noc.telemetry.contract.test.ts` (16): empty state, clasificación de
  salud, agregación por torre, bucket sin torre, RBAC por rol, Cobranza 403, ausencia
  de write-actions (POST/PUT/PATCH/DELETE → 404), sanitización de payload, determinismo.
- `tests/unit/noc.telemetry.service.test.ts` (8): `summarizeHealth` y `aggregateTowers`
  (umbrales, staleness, fallback de nombre, orden estable).
- `tests/unit/noc.telemetry.ui.test.ts` (7): badge READ-ONLY, endpoints GET, sin write,
  widgets, columnas de tabla, empty state, texto de no-acción, integración en App.

## 7. Validación local

```bash
npm run typecheck   # PASS
npm test            # PASS
npm run build       # PASS
```

(Resultados concretos en el reporte de la tarea / commit asociado.)

## 8. Seguridad / sanitización

- Los payloads de `health`/`towers` son contadores y nombres de torre; no incluyen
  `encryptedPassword`, `username`, claves, tokens ni scripts. Verificado por test.
- No se imprime ningún secreto. No se agregan variables de entorno.
- Flags peligrosos intactos: `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`,
  `MIKROTIK_WORKER_LIVE`, `MIKROTIK_COMMIT_MODE` **no** se activan ni se referencian.

## 9. Limitaciones

- Datos desde el **store en memoria** (mismos seeds que 4.11.2); no hay muestreo en
  vivo de RouterOS. Las métricas reflejan lo que el store ya contiene.
- `health` y `towers` derivan del estado actual; no hay series temporales históricas.
- Sin alertas push/Telegram/Email; el panel es observación pura.
- `towers` agrega solo torres con routers vinculados (`linkedTowerId`).

## 10. Riesgos

- **Bajo.** Read-only, sin escritura, sin flags, sin migraciones. El único cambio en
  código aprobado (4.11.2) es aditivo y cubierto por tests.
- Dependencia de la calidad de `linkedTowerId` en los routers para la agregación por torre.

## 11. Qué debe validar Hermes (staging)

1. `git log` incluye el commit de 4.11.3 sobre la base de 4.11.2.
2. Healthchecks `/api/health`, `/api/health/live`, `/api/health/ready` → 200.
3. Flags runtime (por nombre, sin valores): `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`,
   `MIKROTIK_WORKER_LIVE`, `MIKROTIK_COMMIT_MODE` apagados/unset.
4. `GET /api/noc/health` y `GET /api/noc/towers` con JWT real por rol (200 permitidos,
   403 Cobranza).
5. `POST/PUT/PATCH/DELETE` sobre `/api/noc/health` y `/api/noc/towers` → 404/403/405.
6. Payload sin secretos (revisar logs sin imprimir líneas sensibles).
7. UI: tab NOC muestra widgets de telemetría, tablas por router/torre, panel de alertas
   y badge READ-ONLY; consola del navegador sin errores/spam.

## 12. Siguiente fase recomendada

Mantener el orden gated del ROADMAP. **NO** avanzar a Inventory Sync, PROD-1 Manual
Safe Mode, Safe Command Queue, MikroTik/WireGuard runtime DB, Worker Live ni RouterOS
real. La continuación natural tras validar 4.11.3 en staging es **PROD-1 Manual Safe
Mode** (acciones manuales con confirmación humana), que requiere su propia aprobación.
