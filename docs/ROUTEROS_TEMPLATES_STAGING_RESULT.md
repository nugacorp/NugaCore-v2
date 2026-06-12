# RouterOS Templates Library — Staging Result

Fecha UTC: 2026-06-12T15:04:32Z

Commit validado: `8157005 fix(routeros): close templates staging blockers`

Resultado final: **APROBADA**.

Alcance y guardrails:

- Validación de Fase 4.6.3 en staging.
- No se importaron scripts en MikroTik.
- No se pegaron scripts en routers.
- No se tocaron routers reales.
- No se activó commit mode.
- No se ejecutó Worker real.
- No se cambió configuración de red.
- No se imprimieron scripts completos ni secretos en este documento.

## Actualización staging

Checkout actualizado en `/opt/nugacore-staging`:

```text
git fetch origin
git checkout main
git pull --ff-only origin main
```

HEAD validado:

```text
8157005
```

Staging/Coolify fue redeployado sobre imagen del commit `8157005` y quedó healthy.

## Healthchecks

| Endpoint | Resultado |
| --- | --- |
| `GET /api/health` | HTTP 200 |
| `GET /api/health/live` | HTTP 200 |
| `GET /api/health/ready` | HTTP 200 |

## Tests

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 505 passed / 0 failed / 34 skipped |
| `npm run build` | PASS |

Validación específica:

- `tests/unit/rbac.frontend.test.ts` pasa.
- El caso `Super Admin ve todos los módulos (14)` está actualizado y pasa.
- Los contratos de RouterOS Templates pasan, incluyendo descarga con primera línea exacta `# NugaCore`.

## RBAC RouterOS Templates

Validación backend live con JWT real:

| Rol | Catálogo | Generación | Historial |
| --- | ---: | ---: | ---: |
| Super Admin | 200 | 200 | 200 |
| Administrador | 200 | 200 | 200 |
| Técnico | 200 | 200 | 403 |
| Cobranza | 403 | 403 | 403 |
| Soporte | 403 | 403 | 403 |
| Solo lectura | 403 | 403 | 403 |

Validación frontend/RBAC:

- `routeros-templates` visible para Super Admin, Administrador y Técnico.
- `routeros-templates` no visible para Cobranza, Soporte ni Solo lectura.
- La prueba visual frontend de módulos por rol pasa con 14 módulos para Super Admin.

## Catálogo

`GET /api/routeros-templates/catalog` con Super Admin:

- Total de plantillas: 13.
- Campos requeridos presentes: `id`, `name`, `description`, `category`, `routerosVersion`, `tags`, `features`, `generatorVersion`.
- Categorías presentes: `core`, `access`, `tower`, `balancer`, `pppoe`, `monitoring`, `wireguard`, `noc`.

## Generación y descarga `.rsc`

Endpoint validado:

```http
POST /api/routeros-templates/generate
```

Body validado:

```json
{
  "templateId": "noc_ready",
  "routerName": "hermes-test",
  "routerosVersion": "7"
}
```

Resultado:

- HTTP 200 con Super Admin.
- Respuesta incluye `script`, `scriptPreview`, `scriptHash`, `filename`, `apiUsername`, `warnings`, `securityNotice`.
- Filename observado con patrón esperado `nugacore-tpl-noc-ready-hermes-test-<fecha>.rsc`.
- `scriptHash` presente.
- No se imprimió script completo.

Descarga validada:

```http
GET /api/routeros-templates/download/<hash>
```

Resultado:

- HTTP 200 con Super Admin.
- `Content-Type: text/plain; charset=utf-8`.
- `Cache-Control: no-store`.
- `head -1 archivo.rsc` devuelve exactamente:

```text
# NugaCore
```

Pruebas negativas:

- `GET /api/routeros-templates/download/fakehash` → HTTP 404.
- Cobranza intentando descargar hash válido → HTTP 403.

## Validación visual por rol

Validación cubierta por login real/JWT para backend y por prueba frontend de visibilidad de tabs:

| Rol | Templates RouterOS Library visible |
| --- | --- |
| Super Admin | Sí |
| Administrador | Sí |
| Técnico | Sí |
| Cobranza | No |
| Soporte | No |
| Solo lectura | No |

## Regresión de seguridad

Plantillas validadas sin imprimir scripts completos:

- `router_base_wireguard`
- `pcc_2wan`
- `noc_ready`

Se confirmó:

- Contienen `NugaCore`.
- No contienen marcas prohibidas: Livaur, WispHub, SGCM, UISP, WHMCS.
- No contienen policies prohibidas: `sniff`, `sensitive`, `romon`.
- No contienen comandos peligrosos: `/ip service enable ftp`, `/system reboot`.
- `scriptPreview` no expone passwords en claro.
- Historial no expone campo `script`.
- Historial no expone private keys ni preshared keys.

Logs recientes revisados sin imprimir líneas sensibles:

| Patrón | Coincidencias |
| --- | ---: |
| passwords generados/asignaciones claras | 0 |
| private keys | 0 |
| preshared keys | 0 |
| JWTs | 0 |
| service role keys | 0 |
| `MIKROTIK_CREDENTIALS_KEY` | 0 |
| scripts RouterOS completos | 0 |

## Limpieza

- No se crearon recursos en routers.
- No se importaron ni ejecutaron scripts `.rsc`.
- El archivo temporal usado para comprobar `head -1` quedó fuera del repositorio.
- Los scripts generados por API quedan sujetos al TTL de la implementación.

## Final redeploy validation

Fecha UTC: 2026-06-12T16:13:47Z

Validación ejecutada después de corregir el desfase observado entre el repo staging y el contenedor servido por el dominio público.

| Ítem | Resultado |
| --- | --- |
| Repo `/opt/nugacore-staging` | `cee74d05d62c5c7651ca4ad27a2179ddc14f34b6` |
| Commit funcional contenido en HEAD | `8157005 fix(routeros): close templates staging blockers` |
| Contenedor Coolify activo | Healthy |
| Commit/source del contenedor activo | `8157005c76397847a77924535ef0c4cd97c06a2b` |
| `GET /api/health` | HTTP 200; no reporta el commit viejo `2a88694` |
| `GET /api/health/live` | HTTP 200 |
| `GET /api/health/ready` | HTTP 200 |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 505 passed / 0 failed / 34 skipped |
| `npm run build` | PASS |
| `tests/unit/rbac.frontend.test.ts` | PASS |
| RBAC backend live con JWT real | PASS: Super Admin, Administrador y Técnico reciben 200; Cobranza, Soporte y Solo lectura reciben 403 |
| Header `.rsc` generado/descargado | PASS: primera línea exacta `# NugaCore` |
| UI por rol | PASS: `routeros-templates` visible para Super Admin, Administrador y Técnico; no visible para Cobranza, Soporte ni Solo lectura |
| Seguridad | PASS: sin marcas externas, sin policies prohibidas y sin JWT/private keys/preshared keys/service-role keys en logs revisados |

Guardrails mantenidos:

- No se modificó código.
- No se importaron scripts RouterOS.
- No se ejecutaron scripts RouterOS en routers.
- No se tocó ningún router real.
- No se activó commit mode.
- No se avanzó a Fase 4.7.
- No se documentaron secretos.

## Aprobación final

La Fase 4.6.3 queda **APROBADA** en staging para RouterOS Templates Library.

No se avanzó a Fase 4.7.
No se avanzó a commit mode.
No se ejecutaron scripts RouterOS.
No se tocaron routers reales.
