# MIKROTIK PROVISIONING AUDIT — Fase 4.4 (Tarea 1)

Fecha: 2026-06-04
Alcance: auditar el estado actual del dominio MikroTik antes de añadir el
**generador de script de provisioning** y el registro seguro de routers.
No se ejecutan acciones reales sobre routers ni se construye el worker.

## 1. Archivos / superficie actual

| Archivo | Rol |
|---|---|
| `backend/domains/mikrotik/routes.ts` | Rutas Express del dominio. CRUD de routers (mock), lecturas simuladas, consola de comandos simulada, Copiloto Gemini. |
| `backend/state/store.ts` | Store en memoria: `MIKROTIK_ROUTERS`, `MIKROTIK_LOGS`, `MIKROTIK_COMMAND_AUDIT` + helpers (`getUniqueMikrotikRouterId`, `logMikrotikCommandAudit`). |
| `backend/services/crypto.ts` | AES-256-GCM con `MIKROTIK_CREDENTIALS_KEY` (`encryptSecret` / `decryptSecret`). |
| `backend/config/feature-flags.ts` | Flag `USE_DB_MIKROTIK` (hoy `false` → store en memoria). |
| `src/components/MikrotikModule.tsx` | UI: consola SSH simulada, feed de syslogs, Copiloto IA. Usa un array **hardcodeado** `MIKROTIK_ROUTERS` (frontend), no la API. |
| `src/types.ts` | No define tipos de router MikroTik (viven inline en el componente). |

## 2. Endpoints existentes

| Método | Ruta | RBAC actual | Notas |
|---|---|---|---|
| GET | `/api/mikrotik/routers` | super admin, administrador, tecnico, soporte | Devuelve routers saneados (sin password). |
| GET | `/api/mikrotik/routers/:id` | idem | |
| POST | `/api/mikrotik/routers` | super admin, administrador | Requiere `name, ipAddress, username, password`; cifra password. |
| PUT | `/api/mikrotik/routers/:id` | super admin, administrador | Actualización parcial. |
| DELETE | `/api/mikrotik/routers/:id` | super admin, administrador | |
| GET | `/api/mikrotik/routers/:id/health` | super admin, administrador, tecnico, soporte | Diagnóstico simulado. |
| GET | `/api/mikrotik/routers/:id/read/{interfaces,queues,ppp}` | idem | Salida simulada. |
| GET | `/api/mikrotik/command-audit` | super admin, administrador, tecnico | Bitácora de comandos. |
| GET | `/api/mikrotik/logs` | READ_ROLES | **Bajo contrato** (`api-v1.contract.test.ts`). |
| POST | `/api/mikrotik/command` | super admin, administrador, tecnico, soporte | Comando simulado; bloquea writes sin `confirmWrite`, bloquea destructivos (reboot/reset). |
| POST | `/api/mikrotik/copilot` | idem | Gemini con fallback. |

## 3. Mocks actuales

- `store.MIKROTIK_ROUTERS`: 3 routers demo (`mkt-1/2/3`) con `encryptedPassword: 'demo.encrypted.password'` (placeholder, no es un secreto real).
- `getSimulatedCommandOutput()` en `routes.ts`: devuelve salidas RouterOS simuladas por tipo de lectura.
- Frontend `MikrotikModule.tsx`: array `MIKROTIK_ROUTERS` hardcodeado (3 routers) — **no consume la API**; la consola y el copiloto sí llaman al backend (`/command`, `/copilot`).

## 4. Logs / auditoría actuales

- `store.MIKROTIK_LOGS`: feed syslog simulado.
- `store.MIKROTIK_COMMAND_AUDIT` + `logMikrotikCommandAudit()`: registra cada comando (mode read/write, status allowed/blocked/executed, executedBy). **No** guarda secretos.

## 5. Tipos en `src/types.ts`

No hay tipos de router MikroTik en `src/types.ts`. El front usa `MikrotikRouter` definido inline en `MikrotikModule.tsx` (id, name, model, ip, location, cpuCores, ramTotal, rosVersion, promptUser, status). No coincide con el modelo backend (`ipAddress`, `apiPort`, etc.).

## 6. Variables / config relacionadas

- `MIKROTIK_CREDENTIALS_KEY` — clave de cifrado AES-256-GCM. **Obligatoria en producción** (crypto.ts lanza si falta). En dev usa fallback predecible (con warning).
- `USE_DB_MIKROTIK` — feature flag, hoy `false`. El provisioning de esta fase corre sobre el **store en memoria**; la migración SQL queda lista para cuando se active.
- `APP_URL` — usada solo como fallback de la clave de cifrado (no recomendado).

## 7. Cobertura de tests

- `api-v1.contract.test.ts` solo congela `GET /api/mikrotik/logs` (forma `{timestamp,message}`). El resto de rutas MikroTik **no** está bajo contrato → hay libertad para extender POST/PUT y añadir endpoints sin romper tests.

## 8. Brechas para Fase 4.4 (lo que falta)

1. **Modelo de datos**: no existen tablas de routers/credenciales/tokens/scripts/audit en Supabase (solo store en memoria). El registry actual carece de `connection_type`, `management_ip`, `vpn_ip`, `api_ssl_port`, `status`, `last_seen_at`, `notes`.
2. **Generación de credenciales**: hoy el operador teclea username/password manualmente. Falta utilidad que genere usuario único + password fuerte (32+) + token de un solo uso, cifrando con `MIKROTIK_CREDENTIALS_KEY`.
3. **Generador de script RouterOS**: no existe. Hay que generar scripts idempotentes (SSTP y WireGuard) con prefijo NugaCore, permisos mínimos y API limitada a la VPN.
4. **Endpoints de provisioning**: faltan `POST /:id/provisioning-script`, `POST /:id/rotate-credentials`, `POST /:id/test-connection` (dry-run).
5. **UI "Routers MikroTik"**: el módulo no lista routers desde la API ni permite generar/copiar script ni elegir tipo de conexión.
6. **Seguridad**: definir que el script (con secretos) se muestre **una sola vez**, no se persista completo, no se loguee; auditar quién lo generó.

## 9. Decisiones de diseño (resumen para Tareas 2–11)

- **Reusar** `store.MIKROTIK_ROUTERS` extendiéndolo con campos opcionales (`connectionType`, `managementIp`, `vpnIp`, `apiSslPort`, `provisioningStatus`, `notes`, `lastSeenAt`, `encryptionVersion`, `credentialRotatedAt`) → no rompe rutas/tests existentes.
- **Nuevo submódulo** `backend/domains/mikrotik/provisioning/` con `credentials.ts`, `script-generator.ts`, `types.ts`, `store.ts` (tokens/scripts/audit en memoria, solo metadata/hashes).
- **Migración** `supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql`: 5 tablas, idempotente, RLS deny-by-default (igual que el resto). No se ejecuta automáticamente (USE_DB_MIKROTIK sigue `false`).
- **Conexión recomendada**: WireGuard (RouterOS v7) preferido; SSTP como alternativa (v6/v7). El generador permite elegir.
- **Sin acciones destructivas reales** ni worker: `test-connection` es dry-run/mock; `provisioning-script` genera script real; `rotate-credentials` genera credenciales+script nuevos.
- **RBAC**: ver (super admin/administrador/técnico/soporte/solo lectura), crear-editar (super admin/administrador), generar-script y test (super admin/administrador/técnico), rotar credenciales (super admin/administrador). Cobranza **sin acceso**.
