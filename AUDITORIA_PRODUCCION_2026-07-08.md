# Auditoría de preparación para producción — NugaCore-v2

**Fecha:** 2026-07-08
**Auditor:** Revisión senior (código, seguridad web, DevSecOps, arquitectura)
**Alcance:** Código, configuración, dependencias, arquitectura, seguridad, despliegue y estabilidad.
**Staging revisado en vivo:** `https://nugacore-staging.5.180.151.109.sslip.io/`
**Regla respetada:** NO se realizaron cambios. Esto es solo auditoría + reporte. Espero tu aprobación para corregir.

---

## A. Resumen ejecutivo

NugaCore-v2 es un proyecto **sólido en fundamentos**: arquitectura por dominios limpia, RBAC consistente en la mayoría de rutas, RLS deny-by-default en Supabase, cifrado AES-256-GCM para credenciales, redacción de secretos en logs, 1.827 tests pasando, typecheck limpio y build funcional. El equipo claramente pensó en seguridad (existe `validateEnvironment()` con fail-fast, helmet, CORS allowlist y rate-limit).

**El problema central no es el código, es la configuración de entorno.** Toda la coraza de producción está condicionada a `NODE_ENV === 'production'` de forma **exacta**, pero el servidor de staging corre con `NODE_ENV=staging` (confirmado en vivo). Resultado: en el servidor que ya está en internet, el fail-fast, la autenticación solo-por-JWT, HSTS, CSP y el `trust proxy` del rate-limit **están todos desactivados**, aun teniendo la base de datos real conectada (customers, billing, payments, finance).

- **Porcentaje estimado de preparación para producción:** ~65 %.
- **Riesgo general:** **ALTO** (con potencial CRÍTICO según el valor real de `AUTH_TRUST_HEADERS` en staging).
- **¿Se puede publicar ya?** **No.** Hay bloqueadores de configuración y de secretos que deben resolverse antes.

---

## B. Hallazgos críticos

### C-01 — El hardening de producción no aplica en staging (gating por `NODE_ENV === 'production'`)
- **Severidad:** Crítico
- **Ubicación:** `backend/config/env.ts:26`, `backend/common/http-security.ts:47`, `backend/common/auth-context.ts:31`
- **Evidencia:**
  - `export const isProduction = env.NODE_ENV === 'production';`
  - `/api/health` en vivo devuelve `"env":"staging"` con `"supabaseConfigured":true` y dominios reales en DB (`customers, plans, billing, suspension, inventory, support, commercial, purchases, finance, payments`).
  - `validateEnvironment()` hace `if (!isProduction) return;` → en staging **no valida nada**.
  - No existe manejo del valor `'staging'` en ningún punto del backend (`grep 'staging'` en `backend/` → 0 resultados de lógica).
- **Riesgo real:** El servidor que ya está expuesto a internet, con datos reales, corre en modo "no producción": sin fail-fast de configuración, sin HSTS, sin CSP, sin `trust proxy` (rate-limit mal atribuido) y con la puerta de "trusted headers" potencialmente abierta (ver C-02/H-01).
- **Cómo se explotaría:** Un atacante que detecte `env: staging` sabe que las protecciones de borde están relajadas y prioriza los vectores de H-01 (suplantación de rol) y M-01/M-02 (ausencia de HSTS/CSP y rate-limit efectivo).
- **Recomendación:** Que `isProduction` sea verdadero también para staging. Opciones: (a) desplegar staging con `NODE_ENV=production` y un flag aparte para diferencias cosméticas; o (b) introducir `const isHardened = ['production','staging'].includes(NODE_ENV)` y usarlo en env-validation, helmet/HSTS/CSP, trust proxy y auth-context. Correr `validateEnvironment()` en cualquier entorno expuesto.

### C-02 — Secretos reales presentes en `.env` del proyecto (rotación obligatoria)
- **Severidad:** Crítico
- **Ubicación:** `.env`
- **Evidencia:** el `.env` contiene `SUPABASE_SERVICE_ROLE_KEY` (JWT con `exp` ≈ año 2096, es decir efectivamente perpetuo), `SUPABASE_DB_PASSWORD`, `SUPABASE_ANON_KEY` y `STAGING_AUTH_PASSWORD` en texto plano. Además `.env` fija `NODE_ENV=development` y `AUTH_TRUST_HEADERS=true`.
- **Riesgo real:** La `service_role` **bypassa RLS por completo**: quien la posea lee y escribe toda la base de datos sin restricción. Es la llave maestra. Estos valores han quedado expuestos en el entorno de trabajo/sesión.
- **Mitigante:** `.env` **no** está versionado en git (`.gitignore` lo cubre; `git ls-files .env` → vacío). No aparecen secretos en `.tmp_claude_debug.log`.
- **Cómo se explotaría:** Con la service_role + `SUPABASE_URL` un atacante consulta la API REST de Supabase directamente saltándose todo el backend y su RBAC.
- **Recomendación:**
  1. **Rotar ya** en el dashboard de Supabase: service_role key, anon key, contraseña de la base de datos, y `STAGING_AUTH_PASSWORD`.
  2. Cargar secretos solo vía el gestor de secretos de Coolify, nunca en un `.env` en disco compartido.
  3. Corregir `docker-compose.prod.yml`: usa `env_file: .env` — ese archivo tiene `NODE_ENV=development` y `AUTH_TRUST_HEADERS=true`; aunque el bloque `environment:` sobreescribe `NODE_ENV=production`, es frágil. Separar `.env` de despliegue.

---

## C. Hallazgos importantes (no críticos)

### H-01 — Posible suplantación de rol por "trusted headers" fuera de producción
- **Severidad:** Alto
- **Ubicación:** `backend/common/auth-context.ts:22-118`
- **Evidencia:** `computeAllowTrustedHeaders(prod, trustHeadersEnv, supabaseConfigured)` = `trustHeadersEnv || !supabaseConfigured` cuando no es producción. En staging `isProduction=false` y `supabaseConfigured=true`, por lo que el resultado es exactamente el valor de `AUTH_TRUST_HEADERS`. El `.env` y `.env.example` traen `AUTH_TRUST_HEADERS=true`.
- **Riesgo real:** Si staging tiene `AUTH_TRUST_HEADERS=true`, cualquier cliente envía `x-user-role: super admin` / `x-user-id: <lo-que-sea>` y obtiene identidad de super admin **sin credenciales**. Acceso total de escritura a billing, payments, suspensión, inventario, etc.
- **No confirmado en vivo:** no pude inyectar cabeceras personalizadas de forma remota (web_fetch no lo permite y no hay navegador conectado). Debe verificarse el valor real de `AUTH_TRUST_HEADERS` en la config de Coolify de staging. Si es `true`, esto es **CRÍTICO**.
- **Cómo se explotaría:** `curl -H 'x-user-role: super admin' .../api/billing/invoices` (y verbos de escritura) — sin JWT.
- **Recomendación:** Poner `AUTH_TRUST_HEADERS=false` en todo entorno expuesto y, junto con C-01, garantizar que `isProduction`/`isHardened` fuerce identidad solo por JWT en staging. Idealmente eliminar el fallback de trusted-headers salvo en tests/localhost.

### H-02 — Endpoints GIS sin autenticación (exposición de datos de clientes)
- **Severidad:** Alto
- **Ubicación:** `backend/domains/gis/routes.ts` (`/api/gis/map-data`, `/api/gis/customers`, `/api/gis/towers`, `/api/gis/layers`)
- **Evidencia:** Ninguna de estas rutas usa `requireRoles`/`requireAction`; devuelven `store.CLIENTS` completos (nombre, dirección, ciudad, coordenadas), torres e IPs. Contrastan con el resto de dominios, todos protegidos.
- **Riesgo real:** Fuga de PII de clientes y de topología de red (torres, IPs) a cualquier visitante. Hoy en staging responden vacío (el store GIS no está sembrado y `USE_DB_GIS=false`), pero al sembrar datos o activar la DB **se filtra todo**.
- **Cómo se explotaría:** `GET /api/gis/customers` anónimo → listado de clientes.
- **Recomendación:** Añadir `requireRoles(READ_ROLES)` a todas las rutas GIS excepto `/api/gis/health`.

### H-03 — Webhooks de pago falsificables (modo simulado + webhook manual sin firma)
- **Severidad:** Alto
- **Ubicación:** `backend/domains/payments/routes.ts:122-160`, `providers/manual.provider.ts:94`, `providers/mercadopago.provider.ts:20/57`, `providers/openpay.provider.ts:21/65`
- **Evidencia:**
  - `POST /api/payments/webhook/manual|mercadopago|openpay` no llevan `requireRoles` (correcto para webhooks) pero:
  - `SIMULATED = !MP_ACCESS_TOKEN` / `!OP_MERCHANT_ID` → si faltan credenciales, `verifyWebhook()` retorna `{valid:true}` **sin verificar firma**.
  - El provider `manual` **siempre** retorna `{valid:true}`.
  - Además `rawBody` no se captura (`express.json()` ya parseó el cuerpo; `req.rawBody` es `undefined`), así que aun con secreto real el HMAC se calcularía sobre `JSON.stringify(body)` y no sobre el cuerpo crudo → verificación frágil.
- **Riesgo real:** Un atacante hace `POST` de un evento de pago falso → el sistema puede marcar facturas como pagadas y **reactivar el servicio** de un cliente moroso sin pago real.
- **Cómo se explotaría:** `POST /api/payments/webhook/manual` con `{type:'payment.approved', id:'x'}`.
- **Recomendación:** (1) Exigir firma también en el provider manual (token compartido en cabecera). (2) Capturar `rawBody` con un verify de `express.json` y verificar HMAC sobre el crudo. (3) No permitir modo `SIMULATED` cuando `isHardened`. (4) Restringir el webhook manual por IP/secreto.

### H-04 — Dependencia de runtime `xlsx` (SheetJS) 0.18.5 con vulnerabilidades sin parche
- **Severidad:** Alto
- **Ubicación:** `package.json` → `xlsx@^0.18.5`; usada para exportación de reportes.
- **Evidencia:** `npm audit` → *Prototype Pollution* (GHSA-4r6h-8v6p-xvw6) y *ReDoS* (GHSA-5pgg-2g8v-p4x9), severidad HIGH, **"No fix available"** en el registro npm.
- **Riesgo real:** Si en algún flujo se **lee/parsea** un XLSX subido por el usuario, hay riesgo de contaminación de prototipo y DoS. Exportar (escribir) es menos riesgoso.
- **Recomendación:** Migrar a la distribución oficial de SheetJS (`https://cdn.sheetjs.com/`) que sí trae parches, o cambiar a `exceljs`. Confirmar que no se parsea XLSX de entrada del usuario; si se hace, priorizar la migración.

---

## D. Problemas de estabilidad y calidad

- **Build en el entorno de auditoría:** `npm run build` falló con `EPERM: unlink dist/...` — es un artefacto del montaje de la carpeta (el `dist/` existente pertenece a Windows y el sandbox Linux no puede borrarlo). **El build en sí funciona**: reconstruido en un directorio limpio, `vite build` y `esbuild` completan sin errores. Recomendación operativa: el pipeline debe hacer `clean` de `dist/` antes de `build` (ya existe `npm run clean`).
- **Bundle grande:** `dist/assets/index-*.js` ≈ 506 kB (135 kB gzip). Warning de Vite por chunk >500 kB. Considerar `manualChunks` / lazy imports por módulo.
- **Backups / rollback:** No hay documento ni script de estrategia de respaldo o rollback (`grep backup/rollback` en docs/scripts → solo runbooks de otra cosa). Se asume respaldo gestionado por Supabase, pero no está documentado ni verificado.
- **`trust proxy` solo en producción:** detrás de Coolify, en staging el rate-limit atribuye todas las peticiones a la IP del proxy → protección anti-fuerza-bruta inefectiva (ver M-01).
- **Higiene del repo:** ~30 archivos `vitest.config.ts.timestamp-*.mjs` y `.tmp_claude_debug.log` (1,1 MB) en la raíz del working dir (están gitignored, pero conviene limpiarlos). `dist/` versionado localmente pero ignorado en git (correcto).
- **Warnings de lint:** 104 warnings `no-explicit-any`, todos en `tests/`. No bloquean, pero conviene tipar.
- **Cobertura:** Excelente en contract/unit/rbac/billing/payments/http-security. No observé pruebas e2e que cubran el escenario `NODE_ENV=staging` (que es justo donde está el bug C-01) — falta un test que afirme que el hardening aplica en staging.

---

## E. Checklist de producción

| Punto | Estado | Nota |
|---|---|---|
| Auth segura (JWT) | PARTIAL | JWT verificado vía Supabase, pero fallback trusted-headers activo fuera de "production" (H-01, C-01) |
| Roles / permisos | PASS | `requireRoles`/`requireAction` consistente; matriz espejada en DB |
| Validación backend | PASS | Validaciones por endpoint + límite JSON 100 kb + errores tipados |
| CORS | PARTIAL | Allowlist correcta por env; con lista vacía niega cross-origin. Verificar `CORS_ALLOWED_ORIGINS` en staging |
| Rate limit | PARTIAL | Implementado (429 + code); pero sin `trust proxy` en staging es inefectivo (M-01) |
| Headers de seguridad (helmet) | PARTIAL | Helmet activo; HSTS/CSP solo en "production" → ausentes en staging (M-02) |
| HTTPS | PASS | Staging sirve por HTTPS (sslip.io/Coolify) |
| Redirección HTTP→HTTPS | NOT FOUND | Depende del proxy de Coolify; no verificable desde el código |
| Secrets protegidos | FAIL | Secretos reales en `.env`; service_role casi eterna; requieren rotación (C-02) |
| Logs seguros | PASS | `secret-redaction.ts` redacta password/token/service-role/keys |
| Backups | NOT FOUND | Sin estrategia documentada/verificada |
| Health checks | PASS | `/api/health`, `/live`, `/ready`; usados por Docker/Coolify |
| Tests | PASS | 1.827 pasan, 49 skip; typecheck limpio |
| Build | PASS | Funciona en entorno limpio (fallo EPERM era del montaje) |
| DB segura (RLS) | PASS | RLS deny-by-default en todas las tablas; acceso solo por service-role del backend |
| Deploy reproducible | PARTIAL | Dockerfile multistage + compose correctos; frágil por `env_file: .env` (C-02) |
| Monitoreo | PARTIAL | Métricas en memoria + jobs; sin APM/alertas externas |
| Auditoría de acciones | PARTIAL | `security-audit` existe; validar cobertura de acciones sensibles |
| Rollback | NOT FOUND | Sin procedimiento documentado |
| SSRF / path traversal / eval | PASS | No se hallaron `child_process`/`eval`/`dangerouslySetInnerHTML`/fetch a URL dinámica de usuario |

---

## Checklist OWASP Top 10

| Categoría | Estado | Comentario |
|---|---|---|
| A01 Broken Access Control | FAIL | GIS sin auth (H-02) + trusted-headers fuera de producción (H-01/C-01) |
| A02 Cryptographic Failures | PARTIAL | AES-256-GCM correcto; pero HSTS ausente en staging y token en localStorage (M-03) |
| A03 Injection | PASS | Acceso vía SDK Supabase parametrizado; sin SQL crudo con concatenación; sin eval |
| A04 Insecure Design | PARTIAL | Webhooks de pago falsificables por diseño en modo simulado (H-03) |
| A05 Security Misconfiguration | FAIL | `NODE_ENV=staging` desactiva el hardening (C-01); CSP/HSTS off |
| A06 Vulnerable/Outdated Components | PARTIAL | `xlsx` HIGH sin fix (H-04); vulns de dev (vitest/vite/esbuild) solo afectan dev |
| A07 Identification & Auth Failures | PARTIAL | Depende de H-01; rate-limit auth existe pero mal atribuido sin trust proxy |
| A08 Software & Data Integrity | PARTIAL | Firma de webhooks frágil (rawBody no capturado) |
| A09 Logging & Monitoring Failures | PARTIAL | Buen logging + redacción; faltan alertas/APM y auditoría verificada |
| A10 SSRF | PASS | No se observaron fetch a URLs controladas por el usuario |

---

## F. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git ls-files` (grep env/secret) | `.env` NO versionado (solo `.env.example`, `.env.production.example`) ✔ |
| `git log -S 'SUPABASE_SERVICE_ROLE_KEY='` | Sin coincidencias en historial ✔ |
| `npm audit` | 8 vulns (1 crítica, 3 high, 4 moderate). Runtime: `xlsx` HIGH sin fix. Resto (vitest crítico, vite/esbuild/form-data) son dev-only |
| `npm run typecheck` (`tsc --noEmit` x2) | **PASS**, sin errores |
| `npx eslint .` | 0 errores, 104 warnings (`no-explicit-any` en tests) |
| `npx vitest run` | **PASS** — 1.827 tests ok, 49 skip, 153 archivos |
| `npm run build` (en dir montado) | FALLO `EPERM unlink` (permiso del montaje, no del código) |
| `vite build` + `esbuild` (en `/tmp` limpio) | **PASS** — frontend 1.779 módulos; `server.cjs` 657 kB |
| `GET /api/health` (staging en vivo) | 200 · `env:"staging"`, `supabaseConfigured:true`, DB real conectada |
| `GET /api/gis/customers` / `/api/customers` / `/api/billing/invoices` (staging, sin auth) | Cuerpo vacío (probable 401 o store vacío; no concluyente sin cabeceras) |

---

## G. Plan de corrección por fases

### Fase 0 — Bloqueadores críticos antes de publicar
1. **Rotar todos los secretos** (service_role, anon, DB password, staging password) y moverlos al gestor de Coolify (C-02).
2. **Arreglar el gating de entorno** para que staging/producción activen el hardening: `isHardened = NODE_ENV ∈ {production, staging}` aplicado a env-validation, HSTS, CSP, `trust proxy` y auth (C-01).
3. **`AUTH_TRUST_HEADERS=false`** en todo entorno expuesto y verificar el valor actual en Coolify (H-01).
4. Ejecutar `validateEnvironment()` en cualquier entorno expuesto (que deje de retornar temprano fuera de production).

### Fase 1 — Seguridad mínima de producción
5. Proteger endpoints GIS con `requireRoles` (H-02).
6. Endurecer webhooks de pago: firma obligatoria (incluido manual), captura de `rawBody`, prohibir `SIMULATED` en entornos endurecidos (H-03).
7. Confirmar/definir `CORS_ALLOWED_ORIGINS`, CSP (`CSP_CONNECT_SRC` con la URL de Supabase) y HSTS activos en staging.
8. Migrar `xlsx` a la build oficial de SheetJS o a `exceljs` (H-04).

### Fase 2 — Estabilidad y observabilidad
9. Estrategia de backups documentada y probada (restore de Supabase) + procedimiento de rollback de despliegue.
10. Monitoreo/alertas externas (uptime + errores 5xx + latencia) más allá de las métricas en memoria.
11. Verificar cobertura de auditoría de acciones sensibles (pagos, suspensión, cambios de rol).

### Fase 3 — Hardening avanzado
12. Considerar mover el token de `localStorage` a cookie httpOnly + SameSite (M-03) una vez CSP esté firme.
13. Code-splitting del bundle (`manualChunks`), limpieza de artefactos temporales del repo.
14. Revisar timeouts/reintentos de llamadas salientes (RouterOS/MP/OpenPay) y límites de abuso.

### Fase 4 — Pruebas finales y aprobación
15. Test e2e que **afirme** que el hardening aplica con `NODE_ENV=staging` (regresión de C-01).
16. Re-ejecutar `typecheck`, `lint`, `test`, `build`, `npm audit`.
17. Prueba de penetración ligera: intentar bypass con `x-user-role`, webhook de pago falso, acceso GIS anónimo, headers de seguridad y verificación HTTPS/HSTS.

---

## H. Criterio final

- **¿El proyecto está listo para internet?** **No todavía.** El código es de buena calidad, pero la configuración de entorno anula las defensas en el servidor que ya está expuesto.
- **¿Qué bloquea la salida a producción?**
  1. `NODE_ENV=staging` desactiva todo el hardening (C-01).
  2. Secretos reales sin rotar y con `service_role` casi perpetua (C-02).
  3. Riesgo de suplantación de rol por trusted-headers fuera de producción (H-01).
- **¿Qué se debe corregir primero?** En este orden: rotar secretos → arreglar el gating de entorno + `AUTH_TRUST_HEADERS=false` → proteger GIS y webhooks de pago.
- **¿Qué pruebas finales ejecutar antes de publicar?** `typecheck` + `lint` + `vitest` + `build` limpios; `npm audit` sin críticos/high de runtime; y las verificaciones manuales de Fase 4 (bypass de rol, webhook falso, GIS anónimo, cabeceras de seguridad, HTTPS/HSTS).

> Nota de método: no pude confirmar de forma remota el valor de `AUTH_TRUST_HEADERS` en staging ni inyectar cabeceras (web_fetch no lo permite y no hay navegador conectado). Si ese flag está en `true` en staging, H-01 asciende a **CRÍTICO** y debe tratarse como el bloqueador número uno.
