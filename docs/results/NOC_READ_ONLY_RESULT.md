# NOC Read-Only Foundation — Resultado (Fase 4.11.2)

Fecha: 2026-06-18
Estado: Implementada localmente, pendiente validación Hermes en staging.

## Resumen

Se implementó la base de NOC Read-Only usando datos internos ya disponibles en NugaCore.

Alcance cumplido:

- Dominio backend NOC read-only.
- API read-only.
- UI básica NOC read-only.
- Tests backend/frontend.
- Documentación y handoff actualizados.

## Endpoints creados (todos READ-ONLY)

- `GET /api/noc/summary`
- `GET /api/noc/routers`
- `GET /api/noc/alerts`

No se crearon endpoints `POST`, `PUT`, `PATCH`, `DELETE` para `/api/noc/*`.

## Lógica implementada

### `/api/noc/summary`

Devuelve:

- `totalRouters`
- `onlineRouters`
- `offlineRouters`
- `routersWithVpn`
- `routersWithCredentials`
- `pendingProvisioning`
- `staleRouters`
- `activeAlerts`
- `criticalAlerts`
- `warningAlerts`

Comportamiento con 0 routers:

- Resumen estable con todos los campos en `0`.

### `/api/noc/routers`

Devuelve formato operativo:

- `id`
- `name`
- `status`
- `isOnline`
- `connectionType`
- `managementIp`
- `vpnIp`
- `lastSeenAt`
- `lastHealthCheckAt`
- `routerosVersion`
- `cpuUsagePct`
- `memoryUsagePct`
- `healthStatus`

### `/api/noc/alerts`

Alertas derivadas locales y determinísticas desde datos existentes:

- `router_offline`
- `missing_vpn`
- `missing_credentials`
- `health_stale`
- `high_cpu`
- `high_memory`

Sin envío a Telegram/email/push en esta fase.

## RBAC backend

Permitidos (200):

- Super Admin
- Administrador
- Técnico
- Soporte
- Solo lectura

Bloqueado (403):

- Cobranza

## UI NOC

Componente nuevo:

- `src/components/NocReadOnlyModule.tsx`

Integración:

- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/lib/rbac.ts`

Características UI:

- Título `NOC Read-Only`.
- Badge `READ-ONLY`.
- Resumen operativo.
- Tarjetas de Routers totales, Online, Offline, Alertas, VPN, Credenciales.
- Tabla de routers.
- Lista de alertas derivadas.
- Empty state.
- Copy explícito: `Esta vista no ejecuta comandos ni modifica routers.`
- Sin botones de escritura.

## Tests agregados

Backend:

- `tests/contract/noc.read-only.contract.test.ts`
- `tests/unit/noc.read-only.service.test.ts`

Frontend:

- `tests/unit/noc.read-only.ui.test.ts`

Cobertura validada por tests:

- `GET /api/noc/summary` con 0 routers.
- `GET /api/noc/routers` con 0 routers.
- `GET /api/noc/alerts` con 0 routers.
- RBAC permitido con 200.
- Cobranza con 403.
- Sin endpoints write (404/405/403 para métodos write).
- Alertas derivadas determinísticas.
- Payload sin secretos (`encryptedPassword`, `username`, claves/tokens/scripts).
- UI marcada READ-ONLY.
- UI sin operaciones write.
- UI visible para roles permitidos y oculta para Cobranza.
- Empty state presente.

## Restricciones respetadas

- `USE_DB_MIKROTIK`: no activado.
- `USE_DB_WIREGUARD`: no activado.
- `MIKROTIK_WORKER_LIVE`: no activado.
- Sin RouterOS real.
- Sin Worker live.
- Sin migraciones Supabase.
- Sin deploy.
- Sin write actions sobre routers.

## Validación local

Comandos ejecutados:

- `npm run typecheck` → PASS
- `npm test` → PASS (`62 passed`, `7 skipped` archivos; `1079 passed`, `46 skipped` tests)
- `npm run build` → PASS

Nota build:

- Warning de chunk grande en Vite (`> 500 kB`) sin bloquear build.

## Siguiente fase recomendada

- Validación Hermes en staging de 4.11.2 (RBAC real + endpoints + UI).
- Después, planear NOC read-only extendido (health/polling reales) manteniendo gates de seguridad.
