# RouterOS Templates Library — Staging Result

Fecha UTC: 2026-06-12T14:10:42Z

Commit validado: `f067a49 feat(routeros): add RouterOS Templates Library (Fase 4.6.3)`

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

Bloqueadores:

1. `npm test` no pasa completo: falla `tests/unit/rbac.frontend.test.ts` porque el test espera 13 módulos para Super Admin y el código devuelve 14 tras agregar RouterOS Templates.
2. La validación RBAC/API real en staging no pudo completarse con usuarios reales porque el host de Supabase Auth configurado en staging no resolvió DNS desde el entorno de validación. Las rutas protegidas sin sesión verificada responden `401 Unauthorized`, por lo que no fue posible probar con JWT real los códigos 200/403 solicitados para catálogo, generación, descarga e historial.

## Actualización staging

Comandos ejecutados en `/opt/nugacore-staging`:

```text
git fetch origin
git checkout main
git pull --ff-only origin main
```

Resultado:

- Fast-forward aplicado desde `55daa18` hasta `f067a49`.
- Commit de Fase 4.6.3 confirmado en `git log --oneline -8`.

Últimos commits observados:

```text
f067a49 feat(routeros): add RouterOS Templates Library (Fase 4.6.3)
13c23f6 feat(routeros): integrate WireGuard Manager into resource generator
5ffa76a feat(routeros): add resource generator and base WISP WireGuard template
55daa18 docs(wireguard): add manager staging validation result
05d2ae5 feat(wireguard): add central WireGuard manager (servers/peers/IPAM/keys)
66d2e59 feat(mikrotik): add managed VPN provisioning modes
56badc6 docs(mikrotik): validate live read-only worker with CHR
3416a55 docs(mikrotik): validate worker dry-run staging
```

## Redeploy / Coolify

Se disparó redeploy en Coolify para staging y se verificó que el contenedor activo usa imagen del commit `f067a49`.

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

Observación: los tests específicos de RouterOS Templates dentro de la corrida sí pasaron, incluyendo contratos de catálogo, generación, descarga, historial y seguridad. El fallo global es de expectativa RBAC frontend obsoleta/inconsistente con el nuevo módulo.

## Catálogo

Validación real en staging: **bloqueada** por Auth.

Resultado observable sin sesión verificada:

| Endpoint | Resultado |
| --- | --- |
| `GET /api/routeros-templates/catalog` sin JWT válido | HTTP 401 |

No se pudo confirmar en staging con JWT real:

- Super Admin / Admin / Técnico → HTTP 200.
- Cobranza / Soporte / Solo lectura → HTTP 403.
- 13 plantillas y campos obligatorios en respuesta live.
- Categorías `core`, `access`, `tower`, `balancer`, `pppoe`, `monitoring`, `wireguard`, `noc` en respuesta live.

Evidencia indirecta local: el contrato `tests/contract/routeros.templates.contract.test.ts` cubre y pasó estos casos, pero esto no sustituye la validación real de staging.

## Generación

Validación real en staging: **bloqueada** por Auth.

No se pudo completar con Super Admin real:

```http
POST /api/routeros-templates/generate
```

Body objetivo:

```json
{
  "templateId": "noc_ready",
  "routerName": "hermes-test",
  "routerosVersion": "7"
}
```

No se imprimió ningún script completo.

Evidencia indirecta local: los contratos y unit tests de RouterOS Templates validan generación, filename, `scriptHash`, preview saneado y ausencia de marcas prohibidas. Estos tests pasaron dentro de `npm test`, pero la corrida total falló por el test RBAC frontend indicado arriba.

## Políticas prohibidas y comandos peligrosos

Validación real de script live: **bloqueada** por Auth.

Evidencia indirecta local: los tests de RouterOS Templates validaron que los scripts generados no incluyen policies prohibidas ni comandos peligrosos. No se imprimieron scripts completos.

## Descarga

Validación real en staging: **bloqueada** por Auth porque no se pudo generar un hash con sesión real.

No se pudo confirmar en staging:

- `GET /api/routeros-templates/download/<hash>` → HTTP 200.
- `Content-Type: text/plain`.
- `Cache-Control: no-store`.
- Contenido `.rsc` comienza con `# NugaCore`.
- Hash inventado → HTTP 404.
- Cobranza → HTTP 403.

## Historial

Validación real en staging: **bloqueada** por Auth.

No se pudo confirmar en staging:

- Super Admin / Admin → HTTP 200.
- Técnico / Cobranza / Soporte / Solo lectura → HTTP 403.
- Registros sin campo `script`.
- Registros sin passwords, private keys ni preshared keys.

Evidencia indirecta local: los contratos de RouterOS Templates cubren estos casos y pasaron.

## UI

Validación UI sin credenciales reales:

- El bundle desplegado contiene marcadores del módulo `Templates RouterOS` / `routeros-templates`.
- El bundle contiene marcadores de `Descargar .rsc`, `Copiar`, `Historial` y `scriptPreview`.
- La pantalla de login muestra quick-login de staging por rol y no muestra contraseñas.

No se pudo completar login real por rol debido al bloqueo de Supabase Auth descrito. Por tanto, no se pudo confirmar en navegador con sesión real:

- Super Admin/Admin: catálogo, generador, preview, descarga e historial.
- Técnico: módulo visible y sin historial.
- Cobranza/Soporte/Solo lectura: módulo no visible y generate 403.

## Seguridad

Guardrails cumplidos durante esta validación:

- No se importaron scripts en routers.
- No se ejecutaron scripts en MikroTik.
- No se tocaron routers reales.
- No se activó commit mode.
- No se ejecutó Worker real.
- No se cambiaron configuraciones de red.
- No se imprimieron scripts completos en el reporte.

Validación completa de invariantes live para `router_base_wireguard`, `pcc_2wan` y `noc_ready`: **pendiente/bloqueada** por Auth.

## Logs / secret hygiene

Se revisaron logs recientes del contenedor staging activo sin imprimir líneas sensibles. Conteos observados en la ventana revisada:

| Patrón | Coincidencias |
| --- | ---: |
| passwords generados/asignaciones claras | 0 |
| private keys | 0 |
| preshared keys | 0 |
| JWT con prefijo típico | 0 |
| service-role credential markers | 0 |
| MikroTik credential-key env marker | 0 |
| marcadores de script RouterOS completo | 0 |

No se documentaron secretos ni scripts completos.

## Limpieza

- No se crearon recursos persistentes en routers ni se tocó red.
- No se generaron scripts live con sesión real por el bloqueo de Auth.
- Los artefactos temporales locales de validación quedaron fuera del repo (`/tmp`) y no contienen scripts completos en este documento.
- El cache temporal de scripts de la aplicación, si se usa en futuras pruebas, expira por TTL de 1 hora según implementación.

## Conclusión

La Fase 4.6.3 queda en **NO APROBADA** hasta resolver:

1. Actualizar/corregir el test RBAC frontend para reflejar el nuevo total de módulos o ajustar la lista de módulos si el 14.º módulo no debe estar para Super Admin.
2. Corregir la configuración de Supabase Auth de staging o la resolución DNS para permitir login/JWT real.
3. Repetir la matriz live completa de catálogo, generación, descarga, historial, UI por roles, invariantes de seguridad y logs.
