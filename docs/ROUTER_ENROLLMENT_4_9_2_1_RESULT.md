# Fase 4.9.2.1 — Router/WireGuard Snapshot Persistence — Resultado

> Documento de cierre de la Fase 4.9.2.1 según `docs/PRODUCTION_READINESS_CHECKLIST.md`
> sección 17. Estructura: commit, migraciones, flags, tests, healthchecks, pruebas
> funcionales, higiene de seguridad, cleanup, resultado y próximo paso.
>
> Diseño técnico: [`ROUTER_ENROLLMENT_WIREGUARD_SNAPSHOT.md`](./ROUTER_ENROLLMENT_WIREGUARD_SNAPSHOT.md)
> y [`ROUTER_ENROLLMENT_ROUTER_SNAPSHOT.md`](./ROUTER_ENROLLMENT_ROUTER_SNAPSHOT.md).

## Objetivo

Cerrar la brecha entre persistencia del enrollment y re-descarga real del `.rsc`
**después de un restart del contenedor**, sin depender de los stores en memoria
(`store.MIKROTIK_ROUTERS` ni el WG store), y sin exponer secretos.

## Estado actual

**NO APROBADA todavía** — código completo y verificado en local; **pendiente la
validación DB + restart real en staging** (sección "Pendiente para aprobar").

| Gate | Estado |
|---|---|
| Código implementado | ✅ |
| Typecheck | ✅ |
| Tests unit/contract (no-DB) | ✅ 1000/1000 |
| Higiene de secretos/logs | ✅ |
| Migración idempotente | ✅ (revisión estática) |
| Test DB con restart real | ⏳ pendiente staging |
| Validación funcional Hermes | ⏳ pendiente staging |
| Documento de aprobación | 🟡 este doc, a marcar APROBADA tras staging |

## Commit validado

- HEAD: `a0c9b55` — `fix(router-enrollment): avoid wireguard store dependency in db downloads`.
- Working tree alineado con HEAD (sin cambios locales pendientes en el código de la fase).

## Migraciones

| Migración | Propósito | Idempotente |
|---|---|---|
| `20260613120000_router_enrollment_template_parameters.sql` | `template_parameters` JSONB | ✅ |
| `20260617000000_router_enrollment_router_snapshot.sql` | `router_snapshot` JSONB | ✅ |
| `20260617120000_router_enrollment_wireguard_snapshot.sql` | `wireguard_snapshot` JSONB + índice GIN | ✅ `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` |

RLS sin cambios (deny-by-default). La columna no se expone por la vista de API.

## Flags

| Flag | Valor esperado en esta fase | Nota |
|---|---|---|
| `USE_DB_ROUTER_ENROLLMENT` | `true` | el enrollment persiste en Supabase |
| `USE_DB_WIREGUARD` | `false` (permitido) | el `wireguard_snapshot` es la alternativa aprobada por checklist §8 |
| `USE_DB_MIKROTIK` | `false` | el `router_snapshot` cubre la regeneración sin migrar routers |
| `MIKROTIK_WORKER_LIVE` | `false` | **prohibido** en esta fase |
| `MIKROTIK_CREDENTIALS_KEY` | **set** en staging/prod | requerido para cifrar secretos del snapshot |

## Tests ejecutados (local / sandbox)

- `npm run typecheck` → **PASS** (0 errores en código fuente).
- `npx vitest run` (suite no-DB, 53 archivos) → **PASS, 1000/1000**.
- Cobertura específica de la fase (`tests/contract/router-enrollment.db.contract.test.ts`):
  - `10. router_snapshot persiste y download regenera tras restart sin store de routers`.
  - `11. pcc_5wan: download tras restart total NO depende del WireGuard store`.
  - `12. router_base_wireguard: download tras restart regenera vía snapshot WG cifrado`.
  - `13. wireguard_snapshot: secretos CIFRADOS en DB, redactados en la view`.

> Nota de entorno: los tests `*.db.contract.test.ts` requieren `RUN_DB_TESTS=true`
> + credenciales Supabase y **no** se ejecutan en el sandbox de desarrollo. Deben
> correrse en staging (ver runbook).

## Revisión estática de seguridad / log hygiene

- Tipo de vista `RouterEnrollmentWireGuardSnapshotView = Omit<…, 'encryptedPeerPrivateKey' | 'encryptedPresharedKey'>`: los secretos cifrados no forman parte del contrato de API.
- `sanitizeWgSnapshot()` borra ambos campos cifrados antes de devolver el enrollment en `GET /:id` y `list`.
- Secretos cifrados con `encryptSecret()` (`aes-256-gcm`, clave derivada de `MIKROTIK_CREDENTIALS_KEY`); descifrado solo al regenerar el script.
- Logs: `start()` registra solo `enrollmentId/routerId/wgPeerId/wgServerId/templateId`; `download()` solo `enrollmentId`. Sin claves.
- El script completo **no** se persiste (solo `script_hash`).
- Errores controlados: `WIREGUARD_SNAPSHOT_MISSING` / `ROUTER_SNAPSHOT_MISSING` en lugar de 500.

## Pendiente para aprobar (runbook de validación en staging)

Ejecutar en el host de staging. **No** pegar la salida completa si contiene
secretos o scripts; resumir PASS/FAIL y códigos HTTP.

### 1. Baseline y migración

```bash
cd /opt/nugacore-staging
git fetch && git checkout a0c9b55      # o el tag de release correspondiente
git status --short --branch

npm ci
npm run typecheck
npm test
npm run build

# Aplicar migración (idempotente) y recargar PostgREST
supabase db query --linked --file supabase/migrations/20260617120000_router_enrollment_wireguard_snapshot.sql
supabase db query --linked "NOTIFY pgrst, 'reload schema';"
```

### 2. Validadores de schema y tests DB

```bash
RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs   # debe confirmar columna wireguard_snapshot
RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs
RUN_DB_TESTS=true npm run test:db
```

Esperado: el validador lista `template_parameters`, `router_snapshot` y
`wireguard_snapshot`; los tests DB 10–13 pasan.

### 3. Prueba funcional con restart REAL

Caso de aceptación (plantilla WG + parámetros dinámicos):

```bash
# a) Crear enrollment (plantilla que incrusta WireGuard)
curl -fsS -X POST https://<staging>/api/router-enrollment/start \
  -H 'Authorization: Bearer <JWT_ADMIN>' -H 'Content-Type: application/json' \
  -d '{
        "routerName": "TEST-491-A",
        "routerosVersion": "7",
        "templateId": "router_base_wireguard",
        "templateParameters": { "lanCidr": "10.77.0.1/24" }
      }'
# -> 201, guardar enrollmentId

# b) Leer antes del restart
curl -fsS https://<staging>/api/router-enrollment/<id> -H 'Authorization: Bearer <JWT_ADMIN>'   # -> 200

# c) RESTART real del contenedor (vacía stores en memoria)
#    (Coolify: redeploy/restart del servicio nugacore-staging)

# d) Leer y descargar DESPUÉS del restart
curl -fsS -o /dev/null -w '%{http_code}\n' https://<staging>/api/router-enrollment/<id> \
  -H 'Authorization: Bearer <JWT_ADMIN>'                                  # -> 200
curl -fsS https://<staging>/api/router-enrollment/<id>/download \
  -H 'Authorization: Bearer <JWT_ADMIN>' -o /tmp/test-491.rsc -w '%{http_code}\n'   # -> 200, NO 404/500
```

Verificaciones sobre `/tmp/test-491.rsc` (sin pegar el script completo):

```bash
grep -c 'interface/wireguard' /tmp/test-491.rsc     # > 0 (plantilla WG regenerada)
grep -c '10.77.0.1' /tmp/test-491.rsc               # > 0 (LAN custom persistida)
# Confirmar a ojo que NO contiene marcadores de placeholder ni errores
shred -u /tmp/test-491.rsc 2>/dev/null || rm -f /tmp/test-491.rsc
```

Esperado: `GET /:id` y `/download` devuelven **200** tras restart; el `.rsc`
contiene la sección WireGuard y la LAN custom; **no** aparece
`"Servidor WireGuard 'wgs-1' no encontrado"`.

### 4. Caso negativo controlado

```bash
# Enrollment legacy sin snapshot (o tras rotar MIKROTIK_CREDENTIALS_KEY) en plantilla WG:
# /download debe responder error controlado, NO 500.
# Esperado: 404 { "code": "WIREGUARD_SNAPSHOT_MISSING" }
```

### 5. Higiene de logs

```bash
# Revisar logs del contenedor durante start/download: NO debe aparecer
# ninguna private key / preshared key / Authorization: Bearer / script completo.
```

## Cleanup

Tras la validación, eliminar solo los artefactos test creados:

```bash
# Revocar/eliminar el enrollment TEST-491-A y su peer WG de prueba vía API/endpoint de revoke.
# No tocar datos reales.
```

## Resultado final

- [ ] **APROBADA** — marcar aquí tras completar el runbook con evidencia (códigos HTTP, PASS/FAIL).
- Responsable de validación: __________  Fecha: __________  Commit: `a0c9b55`.

## Próximo paso recomendado

Al aprobar 4.9.2.1, avanzar a **Fase 4.9.2.5 — Production Readiness Manual Safe
Mode** (hardening auth/RBAC para producción, backups + restore probado,
healthchecks/alertas básicas). **No** iniciar Fase 4.9.3 (provisioning real /
Worker live) hasta cerrar 4.9.2.5.
