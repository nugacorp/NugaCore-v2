# MIKROTIK SECRET AUDIT — Fase 4.4.1

Fecha: 2026-06-05
Alcance: auditar dónde podrían **imprimirse, persistirse o filtrarse** secretos
de MikroTik (passwords API/VPN, provisioning tokens, blobs cifrados, scripts) y
automatizar su detección. Hardening puro; sin nuevas funcionalidades.

Commit base validado por Hermes: `0819657`.

## 1. Superficie revisada

| Archivo | ¿Maneja secretos? |
|---|---|
| `backend/domains/mikrotik/routes.ts` | Sí — genera credenciales, devuelve script (con secretos) y registra auditoría. |
| `backend/domains/mikrotik/provisioning/credentials.ts` | Sí — genera password/token; cifra. No imprime. |
| `backend/domains/mikrotik/provisioning/script-generator.ts` | Sí — incrusta passwords en el script. No imprime. |
| `backend/domains/mikrotik/provisioning/store.ts` | Auditoría/metadata en memoria. |
| `backend/common/logger.ts` | Logger genérico; serializa `meta` tal cual (riesgo si se le pasa un secreto). |
| `backend/common/security-audit.ts` | Registra `METHOD path` + status. **No** registra body. |
| `src/components/MikrotikRoutersPanel.tsx` | Muestra el script una vez; copia solo el script. |

## 2. Dónde PODRÍAN imprimirse secretos (logs)

- **logger.* en el dominio MikroTik**: no existe ninguna llamada `logger.info/warn/error` que reciba el script, el password o el token. ✅ (verificado por grep).
- **`app.ts` request logger**: `logger.info('${method} ${path}')` — solo método y ruta, sin body ni query. ✅
- **`security-audit.ts`**: persiste `action = "METHOD path"`, sin payload. ✅
- **Riesgo latente**: `logger` serializa cualquier `meta` que se le pase. Si un futuro Worker hiciera `logger.info('x', { password })`, lo imprimiría. → Mitigación: utilidad central de redacción + guía de uso.

## 3. Dónde PODRÍAN persistirse secretos

- **`provisioningStore.recordAudit`**: guarda `requestPayload`, `resultSummary`, `errorMessage`.
  - **HALLAZGO 1 (menor)**: `routes.ts` registraba `resultSummary` con `pass=${maskSecret(plainPassword)}` → exponía 4 caracteres (2+2) del password. Parcial, pero es un secreto en la auditoría.
- **`store.MIKROTIK_ROUTERS[].encryptedPassword`**: blob **cifrado** (AES-256-GCM). Aceptable; nunca se expone por la API (`sanitizeRouter` devuelve `hasCredentials`, no el blob).
- **`provisioningStore.SCRIPTS`/`TOKENS`**: solo `scriptHash` / `tokenHash`. ✅ Nunca el script ni el token en claro.
- **`store.MIKROTIK_LOGS`**: lo alimenta el endpoint `/api/mikrotik/command` (consola), no el provisioning. Riesgo si un operador teclea un comando con password — fuera del alcance de provisioning (se anota como residual).

## 4. Dónde PODRÍAN filtrarse tokens / responses

- **`POST /provisioning-script` y `/rotate-credentials`**: devuelven `script` (con secretos) y `provisioningToken` **una sola vez** — exposición intencional y necesaria. `credentials` solo trae usernames (sin passwords). ✅
- **`GET /routers` y `/routers/:id`**: `fullRouterView` = `sanitizeRouter` + `toProvisionedView`; ninguno incluye `encryptedPassword`, `plainPassword` ni token. ✅
- **`GET /command-audit`**: expone `store.MIKROTIK_COMMAND_AUDIT` (consola), **no** `provisioningStore.AUDIT`. El audit de provisioning no se expone por ningún endpoint. ✅

## 5. Hallazgos

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| 1 | Menor | `resultSummary` de auditoría incluía password parcialmente enmascarado | **Corregido** (se eliminó `pass=`). |
| 2 | Preventivo | `logger` podría imprimir secretos si se le pasaran en `meta` (futuro Worker) | **Mitigado** con `secret-redaction.ts` + red de seguridad en `recordAudit`. |
| 3 | Residual | `/api/mikrotik/command` puede registrar en `MIKROTIK_LOGS` lo que el operador teclee | Documentado; fuera del alcance de provisioning (se abordará con el Worker). |

No se encontraron passwords, tokens ni scripts completos impresos en logs ni
persistidos en claro.

## 6. Acciones de esta fase

1. `backend/common/secret-redaction.ts` — `redactSecret` / `redactString` / `redactScript` / `redactObject`.
2. Quitar el password (enmascarado) del `resultSummary` de auditoría.
3. Red de seguridad: `provisioningStore.recordAudit` redacta `requestPayload`/`resultSummary`/`errorMessage` antes de persistir.
4. Tests automáticos: unidad (redacción) + contrato (higiene: logs, responses, auditoría).
5. Helper `tests/helpers/safe-script-snapshot.ts` para snapshots sin secretos.
