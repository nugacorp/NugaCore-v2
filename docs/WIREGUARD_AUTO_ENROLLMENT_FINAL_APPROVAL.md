# WireGuard Auto Enrollment — Validación Final Fase 4.7

Fecha UTC: 2026-06-12T21:27:03Z

Commit solicitado y validado: `031bd1f fix(router-enrollment): remove secret key names from script preview`

Commit desplegado/validado en staging: `031bd1fda86d3cacbcb6cd986ba256729cefa00e`

Resultado final: **APROBADO**

> Alcance: validación exclusiva en staging. No se importaron scripts en MikroTik, no se ejecutaron scripts RouterOS, no se activó commit mode, no se activó `MIKROTIK_WORKER_LIVE`, no se tocaron routers reales y no se documentan secretos ni scripts completos.

## 1. Staging

Repositorio local `/opt/nugacore-staging` actualizado a `main`.

Validaciones:

| Criterio | Resultado |
| --- | --- |
| `main` contiene `031bd1f` | PASS |
| HEAD local | `031bd1fda86d3cacbcb6cd986ba256729cefa00e` |
| Staging redeployado por Coolify | PASS |
| Imagen activa | `zmjc5lnl0wj3kh0uj14s2p4i:031bd1fda86d3cacbcb6cd986ba256729cefa00e` |
| Contenedor staging | healthy |

Healthchecks post-deploy:

| Endpoint | HTTP |
| --- | --- |
| `GET /api/health` | 200 |
| `GET /api/health/live` | 200 |
| `GET /api/health/ready` | 200 |

Checks locales ejecutados en `/opt/nugacore-staging`:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 40 archivos PASS, 583 tests PASS, 6 archivos/34 tests skipped |
| `npm run build` | PASS |

## 2. scriptPreview final fix

Endpoint validado:

```http
POST /api/router-enrollment/start
```

RouterOS: `7`.

Resultado HTTP: `201`.

Campos obligatorios en la respuesta:

| Campo | Resultado |
| --- | --- |
| `script` | PASS |
| `scriptPreview` | PASS |
| `scriptHash` | PASS |
| `enrollmentId` | PASS |
| `peerId` | PASS |
| `assignedIp` | PASS |

Validación literal de `scriptPreview`:

| Criterio | Resultado |
| --- | --- |
| no contiene `private-key=` | PASS |
| no contiene `preshared-key=` | PASS |
| no contiene `password=` | PASS |
| contiene `<PRIVATE_KEY_OMITIDA>` | PASS |
| contiene `<PASSWORD_OMITIDO>` cuando aplica | PASS |
| contiene `<PRESHARED_KEY_OMITIDA>` cuando aplica | N/A en el script validado |
| no contiene valores reales de secretos del script | PASS |

Resultado del bloqueador pendiente: **PASS**.

## 3. Script real intacto

El campo `script` se validó sin imprimirlo completo.

| Patrón requerido para RouterOS | Resultado |
| --- | --- |
| `private-key=` | PASS |
| `public-key=` | PASS |
| `password=` cuando aplica | PASS |

El script real conserva los parámetros necesarios para RouterOS; solo el `scriptPreview` elimina los nombres de parámetros sensibles.

## 4. Regresión básica

| Criterio | Resultado |
| --- | --- |
| aliases top-level presentes | PASS |
| `wgServerId` inexistente responde controlado | PASS — HTTP 404 |
| `wgServerId` inexistente no responde 500 | PASS |
| `check-online` simulated | PASS — `isOnline=false`, `status=waiting_for_router`, `snapshotSource=simulated` |
| servidor WireGuard default reutilizado | PASS |
| omitir `wgServerId` no crea servidor adicional | PASS |
| `vpnIp` persistida en router y coincide con `assignedIp` | PASS |
| revoke funciona | PASS |

## 5. Limpieza

Limpieza API best-effort:

| Artefacto | Resultado |
| --- | --- |
| enrollments de prueba | revocados por API |
| peers de prueba | revocados por API; activos restantes de la prueba = 0 |
| routers de prueba | eliminados por `DELETE /api/mikrotik/routers/:id` |
| servidor WireGuard default | preservado |

Nota: no existe endpoint público de delete físico para enrollments; la limpieza segura disponible es revocación. No se borró el servidor WireGuard default.

## 6. Decisión

✅ **FASE 4.7 APROBADA**

La corrección final cumple el contrato: `scriptPreview` ya no contiene los patrones literales `private-key=`, `preshared-key=` ni `password=`, y el script real mantiene los patrones necesarios para RouterOS sin imprimirse ni documentarse.
