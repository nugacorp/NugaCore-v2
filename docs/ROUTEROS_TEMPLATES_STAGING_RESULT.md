# RouterOS Templates Library — Staging Result

Fecha UTC: 2026-06-12T14:31:10Z

Commit funcional validado: `f067a49 feat(routeros): add RouterOS Templates Library (Fase 4.6.3)`
Commit documental previo: `6681aaa docs(routeros): validate templates library staging`

Alcance solicitado:

- Validación de Fase 4.6.3 en staging.
- No se importaron scripts en MikroTik.
- No se pegaron scripts en routers.
- No se tocaron routers reales.
- No se activó commit mode.
- No se ejecutó Worker real.
- No se cambió configuración de red.
- No se imprimieron scripts completos ni secretos en este documento.

## Resultado final

**NO APROBADA.**

Supabase Auth fue reactivado y ya no bloquea la validación live. La matriz API/RBAC principal de RouterOS Templates ahora pasa con JWT real. Sin embargo, la fase sigue sin aprobarse por estos bloqueadores:

1. `npm test` no pasa completo: falla `tests/unit/rbac.frontend.test.ts` porque el test espera 13 módulos para Super Admin y el código devuelve 14 tras agregar RouterOS Templates.
2. La descarga live devuelve `Content-Type: text/plain` y `Cache-Control: no-store`, y contiene el header NugaCore en la zona inicial, pero el contenido no empieza estrictamente con `# NugaCore`; empieza con una línea separadora de comentarios antes del header. Esto no cumple literalmente el criterio solicitado: "empieza con # NugaCore".
3. UI por rol queda parcialmente validada: se confirmó presencia de marcadores del módulo en bundle/login, pero no se completó navegación autenticada por rol en navegador sin exponer credenciales/tokens en la traza de herramientas.

## Actualización staging

Checkout revisado en `/opt/nugacore-staging`:

```text
## main...origin/main
HEAD 6681aaa docs(routeros): validate templates library staging
```

Commit de Fase 4.6.3 confirmado previamente:

```text
f067a49 feat(routeros): add RouterOS Templates Library (Fase 4.6.3)
```

## Supabase Auth / DNS

Después de reactivar Supabase, el host Auth configurado volvió a resolver DNS:

```text
elshnzkceutvjzxvzqad.supabase.co DNS: OK
A records: 2
```

Se validó login real contra Supabase Auth para los seis usuarios staging, sin imprimir passwords ni tokens:

| Rol | Login Supabase Auth |
| --- | --- |
| Super Admin | HTTP 200 |
| Admin | HTTP 200 |
| Técnico | HTTP 200 |
| Cobranza | HTTP 200 |
| Soporte | HTTP 200 |
| Solo lectura | HTTP 200 |

## Redeploy / Coolify

El staging respondió con healthchecks correctos después de la reactivación de Supabase. No se documentan IDs internos de despliegue ni secretos.

## Healthchecks

Healthchecks externos contra staging:

| Endpoint | Resultado |
| --- | --- |
| `GET /api/health` | HTTP 200 |
| `GET /api/health/live` | HTTP 200 |
| `GET /api/health/ready` | HTTP 200 |

## Tests

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | FAIL |
| `npm run build` | PASS |

Detalle del fallo de `npm test`:

```text
FAIL tests/unit/rbac.frontend.test.ts > RBAC visual por rol (frontend) > Super Admin ve todos los módulos (13)
AssertionError: expected 14 to be 13
```

Observación: los tests específicos de RouterOS Templates dentro de la corrida sí pasaron, incluyendo contratos de catálogo, generación, descarga, historial y seguridad. El fallo global es una expectativa RBAC frontend obsoleta/inconsistente con el nuevo módulo.

## Catálogo

Validación live con JWT real:

| Rol | Resultado esperado | Resultado observado |
| --- | ---: | ---: |
| Super Admin | HTTP 200 | HTTP 200 |
| Admin | HTTP 200 | HTTP 200 |
| Técnico | HTTP 200 | HTTP 200 |
| Cobranza | HTTP 403 | HTTP 403 |
| Soporte | HTTP 403 | HTTP 403 |
| Solo lectura | HTTP 403 | HTTP 403 |

Validación de body con Super Admin:

- Total de plantillas: 13.
- Campos requeridos presentes: `id`, `name`, `description`, `category`, `routerosVersion`, `tags`, `features`, `generatorVersion`.
- Categorías presentes: `core`, `access`, `tower`, `balancer`, `pppoe`, `monitoring`, `wireguard`, `noc`.

## Generación

Endpoint validado:

```http
POST /api/routeros-templates/generate
```

Body principal validado:

```json
{
  "templateId": "noc_ready",
  "routerName": "hermes-test",
  "routerosVersion": "7"
}
```

Resultado con Super Admin:

- HTTP 200.
- Respuesta incluye `script`, `scriptPreview`, `scriptHash`, `filename`, `apiUsername`, `warnings`, `securityNotice`.
- Filename observado: `nugacore-tpl-noc-ready-hermes-test-2026-06-12.rsc`.
- `scriptHash` presente.
- Script contiene `NugaCore`.
- No se imprimió script completo.
- `scriptPreview` no expuso passwords en claro.
- Roles Cobranza, Soporte y Solo lectura recibieron HTTP 403 al intentar generar.

## Políticas prohibidas y comandos peligrosos

Se validaron al menos estas plantillas con datos ficticios/sanitarios:

- `router_base_wireguard`
- `pcc_2wan`
- `noc_ready`

Para los scripts generados se confirmó programáticamente, sin imprimir scripts completos:

- Contienen `NugaCore`.
- No contienen marcas prohibidas: `livaur`, `wisphub`, `uisp`, `sgcm`, `whmcs`.
- No contienen policies prohibidas: `sniff`, `sensitive`, `romon`.
- No contienen comandos peligrosos: `/ip service enable ftp`, `/system reboot`.
- `scriptPreview` no expone secretos en claro.

Nota: `pcc_2wan` no devuelve `apiUsername`, lo cual es consistente con una plantilla de balanceo que no requiere usuario API; el requisito estricto de `apiUsername` fue validado para el caso principal `noc_ready`.

## Descarga

Usando hash generado para `noc_ready`:

| Prueba | Resultado esperado | Resultado observado |
| --- | ---: | ---: |
| Super Admin descarga hash válido | HTTP 200 | HTTP 200 |
| `Content-Type` | `text/plain` | `text/plain; charset=utf-8` |
| `Cache-Control` | `no-store` | `no-store` |
| Cobranza descarga hash válido | HTTP 403 | HTTP 403 |
| Super Admin descarga `fakehash` | HTTP 404 | HTTP 404 |

Contenido descargado:

- Contiene script `.rsc`.
- Contiene header NugaCore dentro de la cabecera inicial.
- No contiene marcas prohibidas.
- No se imprimió el contenido completo.

Bloqueador estricto: el primer texto del archivo no es exactamente `# NugaCore`; antes aparece una línea separadora de comentarios. Si el criterio "empieza con # NugaCore" debe cumplirse literalmente, requiere ajuste.

## Historial

Validación live con JWT real:

| Rol | Resultado esperado | Resultado observado |
| --- | ---: | ---: |
| Super Admin | HTTP 200 | HTTP 200 |
| Admin | HTTP 200 | HTTP 200 |
| Técnico | HTTP 403 | HTTP 403 |
| Cobranza | HTTP 403 | HTTP 403 |
| Soporte | HTTP 403 | HTTP 403 |
| Solo lectura | HTTP 403 | HTTP 403 |

Higiene de body:

- Registros no exponen campo `script`.
- No se detectaron passwords en claro.
- No se detectaron private keys.
- No se detectaron preshared keys.
- No se detectaron JWTs en body de historial.

## UI

Validación UI/bundle sin imprimir credenciales:

- El bundle desplegado contiene marcadores del módulo `Templates RouterOS` / `routeros-templates`.
- El bundle contiene marcadores de `Descargar .rsc`, `Copiar`, `Historial` y `scriptPreview`.
- La pantalla de login muestra quick-login de staging por rol y no muestra contraseñas.

Pendiente para cierre total: navegación autenticada en navegador por Super Admin/Admin/Técnico/Cobranza/Soporte/Solo lectura sin exponer password ni token en la traza de herramientas. La matriz backend equivalente ya fue validada con JWT real.

## Seguridad

Guardrails cumplidos durante esta validación:

- No se importaron scripts en routers.
- No se ejecutaron scripts en MikroTik.
- No se tocaron routers reales.
- No se activó commit mode.
- No se ejecutó Worker real.
- No se cambiaron configuraciones de red.
- No se imprimieron scripts completos en el reporte.
- No se imprimieron tokens, passwords, service-role keys ni credenciales.

## Logs / secret hygiene

Se revisaron logs recientes de contenedores NUGACORE relevantes sin imprimir líneas sensibles. En la ventana revisada no se detectaron:

| Patrón | Coincidencias |
| --- | ---: |
| passwords generados/asignaciones claras | 0 |
| private keys | 0 |
| preshared keys | 0 |
| JWT con prefijo típico | 0 |
| service-role credential markers | 0 |
| MikroTik credential-key env marker | 0 |
| marcadores de script RouterOS completo | 0 |

## Limpieza

- No se crearon recursos persistentes en routers ni se tocó red.
- Los scripts generados fueron solo respuestas de software/API; no se pegaron ni importaron en ningún router.
- Los artefactos temporales locales de validación quedaron fuera del repo (`/tmp`) y no contienen scripts completos en este documento.
- El cache temporal de scripts de la aplicación, si aplica, expira por TTL de la implementación.

## Conclusión

La Fase 4.6.3 queda en **NO APROBADA** hasta resolver:

1. Actualizar/corregir `tests/unit/rbac.frontend.test.ts` para reflejar el nuevo total de módulos o ajustar la lista de módulos si el 14.º módulo no debe estar para Super Admin.
2. Ajustar el encabezado de descarga si se mantiene el requisito literal de que el archivo empiece con `# NugaCore`.
3. Completar la validación UI autenticada por rol sin exposición de credenciales/tokens en logs o trazas.
