# MIKROTIK SECRET HARDENING — Fase 4.4.1

Fecha: 2026-06-05
Estado: validación de secretos del provisioning MikroTik **automatizada**.
Hardening puro — sin nuevas funcionalidades, sin Worker.

Auditoría: [MIKROTIK_SECRET_AUDIT.md](MIKROTIK_SECRET_AUDIT.md) · Provisioning: [MIKROTIK_PROVISIONING.md](MIKROTIK_PROVISIONING.md).

## 1. Amenazas mitigadas

| Amenaza | Mitigación |
|---|---|
| Password MikroTik en logs | No se loguea; `redactString`/`redactObject` disponibles; test de higiene spia la consola y falla si aparece. |
| Script completo en logs | Nunca se loguea; test verifica que la línea `/user add name="nugacore_…"` no aparece en consola. |
| Provisioning token en logs/respuestas posteriores | Token solo en la respuesta única; test verifica ausencia en logs, en `GET router` y en auditoría. |
| Secreto persistido por error | `provisioningStore.recordAudit` redacta `requestPayload`/`resultSummary`/`errorMessage`; solo se guardan hashes (`scriptHash`/`tokenHash`) y blobs cifrados. |
| Fuga futura por el Worker | Utilidad central `secret-redaction.ts` lista para envolver cualquier log/persistencia. |

## 2. Secretos protegidos

- Passwords API y VPN (en claro solo dentro del script de un solo uso).
- Provisioning tokens (en claro solo en la respuesta única; se guarda `tokenHash`).
- Blobs cifrados (`encryptedPassword`) — nunca expuestos por la API.
- JWT / Bearer / service-role / encryption keys — redactados por `redactString`/`redactObject` por patrón de valor y por nombre de clave.

## 3. Utilidad central — `backend/common/secret-redaction.ts`

| Función | Uso |
|---|---|
| `redactSecret(value)` | Colapsa un secreto crudo conocido → `****REDACTED****`. |
| `redactString(text)` | Redacta `password=`, `token=`, `secret=`, `Bearer …`, JWT en texto libre/scripts. Conserva `public-key`. |
| `redactScript(script)` | Alias semántico para scripts RouterOS. |
| `redactObject(obj)` | Clon profundo; redacta valores con claves secretas y secretos embebidos en strings; tolera ciclos. |

Snapshot seguro para Hermes: `tests/helpers/safe-script-snapshot.ts` →
`safeScriptSnapshot(script)` redacta secretos y normaliza usernames volátiles
(`nugacore_<ID>`) para comparaciones deterministas entre fases.

## 4. Qué se sigue permitiendo (por diseño)

- El **script** se devuelve **una vez** con los secretos en claro (necesario para pegarlo en RouterOS).
- El **token** de provisioning se devuelve una vez.
- El **blob cifrado** del password persiste en el registro (cifrado AES-256-GCM); nunca se expone vía API.
- `GET /command-audit` sigue exponiendo la auditoría de la **consola** de comandos (no la de provisioning).

## 5. Cobertura automática de regresión

- `tests/unit/mikrotik.secret-redaction.test.ts` — redacción de password/token/JWT/Bearer, preservación de `public-key`, `redactObject` profundo + ciclos, snapshot seguro y determinista.
- `tests/contract/mikrotik.secret-hygiene.test.ts` — durante `provisioning-script`/`rotate`:
  - la consola **no** contiene passwords/token/script;
  - `GET router` **no** devuelve `encryptedPassword`/`plainPassword`/token;
  - `provisioningStore.AUDIT` **no** contiene passwords/token/script.

Resultado: `typecheck` ✅ · `test` ✅ 219 passed (32 skipped) · `build` ✅.

## 6. Riesgos restantes

- El script en claro existe en el cliente (respuesta + portapapeles) por necesidad; usar canal seguro al pegarlo. Mitigación operativa, no de código.
- `/api/mikrotik/command` (consola simulada) puede registrar en `MIKROTIK_LOGS` lo que el operador teclee; se blindará al construir el Worker (escribir comandos vía API parametrizada, no texto libre).
- `redactString` cubre patrones conocidos; un formato de secreto desconocido podría no detectarse. La defensa principal es **no pasar secretos a logs**; la redacción es la segunda capa.
- Registro en memoria hasta activar `USE_DB_MIKROTIK`; al persistir en Supabase, mantener la regla de “solo hashes/metadata” (el esquema 4.4 ya la respeta).

## 7. Preparación para el Worker MikroTik

- El Worker debe envolver **todo** log/persistencia de payloads con `redactObject`/`redactString`.
- `test-connection` real deberá registrar solo metadata (sin credenciales) reutilizando el patrón de `recordAudit` (ya redacta).
- Para snapshots de scripts/configuración en CI, usar `safeScriptSnapshot`.

## 8. Confirmación de readiness

- **Fase 4.5 (Suspensiones)**: el manejo de secretos MikroTik queda blindado y con regresión automática; no bloquea Suspensiones.
- **Fase 4.6 (Worker MikroTik)**: utilidad de redacción + helper de snapshot + auditoría redactada dejan el terreno listo para conectar acciones reales sin filtrar secretos.

El sistema queda **listo para Fase 4.5 y 4.6** desde el punto de vista de higiene de secretos. No se avanza a ninguna de ellas en esta fase.
