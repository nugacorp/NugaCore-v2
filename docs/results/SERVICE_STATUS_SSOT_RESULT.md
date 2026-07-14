# NugaCore — Service Status SSOT · RESULTADO (Pre-PROD-7)

Fuente única de **estado operativo de servicio** previa a PROD-7. Resuelve el
riesgo #5 de la auditoría de consistencia: el KPI "Suspendidos" no tenía una
fuente oficial definitiva.

**Estado: ✅ COMPLETADO.** No se implementó PROD-7, ni suspensión/reactivación
real, ni RouterOS Write, ni Worker Live, ni MikroTik Runtime. Read-only +
solicitudes en modo `dryRun`.

---

## 1. Las 4 dimensiones (no se mezclan)

| Dimensión | Significado | Fuente |
| --- | --- | --- |
| `customerStatus` | Estado administrativo | CRM (`Client.status`) |
| `billingStatus` | Estado financiero | Billing (facturas vencidas) |
| `serviceStatus` | **Estado operativo OFICIAL en NugaCore** | **Service Status (este dominio)** |
| `routerStatus` | Estado observado en la red | No disponible aquí → `null` |

## 2. Estados implementados (`serviceStatus`)

`ACTIVE`, `PENDING_INSTALL`, `SUSPENSION_PENDING`, `SUSPENDED`,
`REACTIVATION_PENDING`, `CANCELLED`. (No existen `EXECUTED`/`RUNNING`: pertenecen
a PROD-7.)

### Reglas de derivación (puras, sin efectos)

1. `baja` → `CANCELLED` ; `lead` → `PENDING_INSTALL`.
2. Solicitud pendiente del operador (overlay): suspensión → `SUSPENSION_PENDING`;
   reactivación → `REACTIVATION_PENDING`.
3. `suspended` + vencido → `SUSPENDED` ; `suspended` + al corriente → `REACTIVATION_PENDING`.
4. `active` + vencido → `SUSPENSION_PENDING` ; `active` + al corriente → `ACTIVE`.

Clasificación con data semilla: `ACTIVE=3`, `SUSPENDED=1` (c-4),
`SUSPENSION_PENDING=1` (c-5), `PENDING_INSTALL=2` (leads), resto `0`.

## 3. Endpoints

| Método | Ruta | RBAC | Efecto |
| --- | --- | --- | --- |
| GET | `/api/service-status/customers` | Lectura (6 roles) | Lista de vistas |
| GET | `/api/service-status/customers/:customerId` | Lectura | Vista por cliente |
| GET | `/api/service-status/summary` | Lectura | Conteos por estado |
| GET | `/api/service-status/audit` | Lectura | Audit trail (`?customerId`) |
| POST | `/api/service-status/customers/:customerId/request-suspension` | super admin / administrador / cobranza | Marca `SUSPENSION_PENDING` (dryRun) |
| POST | `/api/service-status/customers/:customerId/request-reactivation` | super admin / administrador / cobranza | Marca `REACTIVATION_PENDING` (dryRun) |

Las solicitudes NO ejecutan cambios reales: solo cambian el estado a pendiente y
agregan un evento de auditoría con `dryRun=true`. Técnico/Soporte/Solo lectura →
`403`.

## 4. Auditoría (audit trail)

Cada cambio guarda: `id`, `customerId`, `previousStatus`, `nextStatus`, `reason`,
`actorRole`, `createdAt`, `dryRun=true`.

## 5. Integraciones

- **systemMetrics**: nuevo `serviceStatus` en el snapshot. El KPI "Suspendidos"
  (`dashboard-stats.suspendedClients`) ahora proviene de `serviceStatus.suspended`,
  **no** del `customerStatus` del CRM.
- **Auditor `/api/system/data-consistency`**: `suspendedCustomers` declara
  `source: "ServiceStatus"` y se recalcula desde su SSOT; `ServiceStatus` se suma
  a `modules`.
- **Dashboard Ejecutivo**: el KPI Suspendidos consume Service Status de forma
  transitiva (sin cambios de diseño visual).
- **Client 360**: muestra las 4 dimensiones (`Estado de servicio`) y las acciones
  Suspender/Reactivar llaman a `request-suspension`/`request-reactivation`
  indicando "No se ejecutan cambios en MikroTik. Estado marcado como pendiente."

## 6. Seguridad

`tests/unit/service-status.static-safety.test.ts` escanea
`backend/domains/service-status/**` y falla si aparece RouterOS/MikroTik, worker,
shell, verbos de ejecución (`.add(`/`.set(`/`.remove(`/`.execute(`/`spawn(`/
`child_process`), comandos (`/ppp secret`, `/ip firewall`, …) o estados
`EXECUTED`/`RUNNING`.

## 7. Archivos

### Creados

- `backend/domains/service-status/types.ts`
- `backend/domains/service-status/store.ts`
- `backend/domains/service-status/service.ts`
- `backend/domains/service-status/routes.ts`
- `tests/unit/service-status.service.test.ts`
- `tests/unit/service-status.audit.test.ts`
- `tests/unit/service-status.static-safety.test.ts`
- `tests/unit/data-consistency.service-status.test.ts`
- `tests/unit/customer360.service-status.test.ts`
- `tests/contract/service-status.contract.test.ts`
- `tests/contract/service-status.rbac.test.ts`
- `tests/contract/dashboard.service-status.test.ts`
- `docs/SERVICE_STATUS_SSOT_RESULT.md`

### Modificados

- `backend/register-routes.ts` — registra `serviceStatusRoutes`.
- `backend/domains/system/metrics.ts` — `ServiceStatusMetrics` + snapshot.
- `backend/domains/system/consistency.ts` — Suspendidos desde Service Status.
- `backend/domains/dashboard/routes.ts` — `suspendedClients` desde `serviceStatus`.
- `src/components/Client360Panel.tsx` — sección "Estado de servicio".
- `src/components/CrmModule.tsx` — carga estado de servicio + solicitudes dryRun.
- `docs/DATA_CONSISTENCY_AUDIT.md`, `docs/DATA_CONSISTENCY_AUDIT_RESULT.md`,
  `ROADMAP.md`, `docs/PROJECT_STATUS_CURRENT.md`,
  `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md`.

## 8. Tests agregados (42, todos PASS)

| Archivo | Tests | Cobertura |
| --- | --- | --- |
| `service-status.service.test.ts` | 15 | derivación + transiciones dryRun |
| `service-status.audit.test.ts` | 3 | audit trail + dryRun + sin EXECUTED/RUNNING |
| `service-status.contract.test.ts` | 6 | forma de endpoints + 404/409 |
| `service-status.rbac.test.ts` | 4 | lectura vs solicitud + 403 |
| `service-status.static-safety.test.ts` | 4 | escaneo de seguridad |
| `data-consistency.service-status.test.ts` | 3 | Suspendidos desde Service Status |
| `customer360.service-status.test.ts` | 5 | panel + wiring CrmModule |
| `dashboard.service-status.test.ts` | 2 | KPI Suspendidos == summary |

## 9. Validación

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ PASS — 1632 passed, 49 skipped (DB opt-in) |
| `npm run build` | ✅ PASS |

## 10. Qué debe validar Hermes (staging)

1. `/api/service-status/summary` y `/customers` con `USE_DB_CUSTOMERS`/
   `USE_DB_BILLING=true` (datos reales) — conteos coherentes.
2. RBAC real (JWT): cobranza puede solicitar; técnico/soporte/solo lectura → 403.
3. POST request-suspension/reactivation: respuesta `dryRun=true`, audit trail
   creado, y **sin** cambios en MikroTik / red.
4. KPI "Suspendidos" del Dashboard == `service-status/summary.SUSPENDED`.
5. `/api/system/data-consistency` → `healthy:true` con `suspendedCustomers`
   fuente `ServiceStatus`.
6. Client 360 muestra las 4 dimensiones y el aviso de "estado pendiente".
7. Confirmar que el dominio NO ejecuta nada real (revisar static-safety guard).
