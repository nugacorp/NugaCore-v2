# Reporte de auditoría de producción — NugaCore-v2

**Fecha:** 2026-07-08
**Rol:** Ingeniero senior / auditor de seguridad web / DevSecOps / arquitecto de producción
**Alcance:** Código, configuración, dependencias, arquitectura, seguridad, DB, despliegue, estabilidad.
**Staging en vivo:** `https://nugacore-staging.5.180.151.109.sslip.io/`
**Regla respetada:** NO se hicieron cambios. Solo auditoría + reporte. Espero tu aprobación para corregir.

> Nota de honestidad metodológica: validé con comandos reales (typecheck, lint, tests, build, npm audit) y con lectura directa del código. La verificación **en vivo** de headers HTTP y cuerpos JSON quedó **limitada**: la extensión de Chrome no estaba conectada y el fetch de servidor no expone headers ni renderiza cuerpos JSON de la API. Donde no pude confirmar en el servidor, lo digo explícitamente y lo dejo como "verificar en servidor".

---

## A. Resumen ejecutivo

NugaCore-v2 tiene **fundamentos sólidos**: arquitectura por dominios limpia, RBAC consistente en casi todas las rutas, RLS deny-by-default en Supabase (todas las tablas con RLS activo y sin policies permisivas, acceso solo vía backend con service-role), redacción de secretos en logs, helmet + CORS allowlist + rate-limit, `validateEnvironment()` con fail-fast, y una base de pruebas fuerte.

**Comandos reales ejecutados:** typecheck **PASS**, eslint **PASS (0 errores, 104 warnings)**, tests **1827 passed / 49 skipped**, build **PASS** (en directorio limpio). `npm audit`: **8 vulnerabilidades (1 crítica, 3 altas, 4 moderadas)**, la mayoría en dependencias solo-dev.

Pese a esto, **hay bloqueadores que impiden salir a internet hoy**. Los tres más serios:

1. **Endpoints GIS sin autenticación** (`/api/gis/*`) — exponen datos de negocio sin ningún guard, a diferencia de todos los demás dominios.
2. **Webhook de pago manual sin firma ni auth** (`/api/payments/webhook/manual`) — cualquiera en internet puede marcar un pago como aprobado y disparar la reactivación de un cliente.
3. **Toda la coraza de producción está condicionada a `NODE_ENV === 'production'` de forma exacta**, y el `.env` local trae `AUTH_TRUST_HEADERS=true`. Si el servidor de staging/producción no corre con `NODE_ENV` exactamente `production`, se desactivan HSTS, CSP, el fail-fast y —lo más grave— se habilita la identidad por headers (`x-user-role`), lo que sería un **bypass total de autenticación**.

- **Preparación estimada para producción:** ~60–65 %.
- **Riesgo general:** **ALTO** (con potencial **CRÍTICO** según el `NODE_ENV` y `AUTH_TRUST_HEADERS` reales del servidor).
- **¿Se puede publicar ya?** **No.** Primero hay que cerrar los hallazgos críticos y confirmar la configuración del servidor.

---

## B. Hallazgos críticos

### C-01 · Webhook de pago manual sin firma ni autenticación
- **Severidad:** Crítico
- **Ubicación:** `backend/domains/payments/routes.ts:159` + `backend/domains/payments/providers/manual.provider.ts:32` + `backend/domains/payments/service.ts:127,336`
- **Evidencia:** La ruta se registra sin guard: `router.post('/api/payments/webhook/manual', handleWebhook('manual'))`. El proveedor manual implementa `verifyWebhook()` devolviendo **siempre** `{ valid: true }`. `isApprovedEvent()` acepta el evento si el `type`/`status` del cuerpo (controlado por el atacante) contiene `approved`/`completed`/`paid`/`success`. El flujo aprobado ejecuta `updateOrderStatus('completed')`, `confirmPaymentOnInvoice()` y `reactivateCustomerService()`.
- **Riesgo real:** Fraude de pagos y reactivación de servicio sin pagar. Un atacante puede confirmar facturas y reactivar clientes suspendidos por mora.
- **Cómo se explotaría (alto nivel):** Enviando una petición POST al endpoint público con un cuerpo que declare un estado "aprobado" y el identificador de una orden. No requiere credenciales ni firma.
- **Recomendación:** Exigir autenticación/firma también en el proveedor manual (p. ej. un token compartido `WEBHOOK_SECRET_MANUAL` obligatorio o restringir el endpoint a red interna/RBAC de operador). Nunca dejar `verifyWebhook` como `valid:true` incondicional en un endpoint expuesto.

### C-02 · Endpoints GIS sin control de acceso
- **Severidad:** Crítico (Alto mientras GIS use store en memoria; Crítico al pasar a DB real)
- **Ubicación:** `backend/domains/gis/routes.ts` (todas las rutas: `/api/gis/layers`, `/api/gis/map-data`, `/api/gis/customers`, `/api/gis/towers`)
- **Evidencia:** Ninguna ruta usa `requireRoles`/`requireAction`; el archivo ni siquiera importa `rbac`. `/api/gis/map-data` y `/api/gis/customers` devuelven nombre, dirección, ciudad, plan e IP de clientes.
- **Riesgo real:** Exposición de PII de clientes y topología de red sin autenticación. Hoy el impacto está **mitigado** porque GIS lee del store en memoria (datos demo en Fase 0, `USE_DB_GIS=false`), pero en cuanto se active `USE_DB_GIS` filtrará datos reales. Además es una **inconsistencia de diseño**: es el único dominio sin guard.
- **Cómo se explotaría:** Accediendo directamente a las rutas `/api/gis/*` sin token.
- **Recomendación:** Añadir `requireRoles(READ_ROLES)` a las rutas de datos GIS (igual que `coverage`, `service-status`, etc.). Dejar público, si acaso, solo `/api/gis/health`.

### C-03 · Coraza de producción atada a `NODE_ENV === 'production'` exacto + `AUTH_TRUST_HEADERS=true` en `.env`
- **Severidad:** Crítico (a verificar en servidor)
- **Ubicación:** `backend/common/http-security.ts:47`, `backend/common/auth-context.ts:21-34,96`, `backend/config/env.ts:39`, `.env`
- **Evidencia:** HSTS, CSP, `trust proxy` y el fail-fast de `validateEnvironment()` se activan solo si `NODE_ENV === 'production'`. `computeAllowTrustedHeaders()` habilita la identidad por header `x-user-role` cuando NO es producción y `AUTH_TRUST_HEADERS=true`. El `.env` del repo contiene `NODE_ENV=development` y `AUTH_TRUST_HEADERS=true`.
- **Riesgo real:** Si el servidor expuesto corre con `NODE_ENV` distinto de `production` (p. ej. `staging`, `development`) y hereda `AUTH_TRUST_HEADERS=true`, cualquiera puede declararse "super admin" enviando un header, **saltándose por completo la autenticación**. Además quedarían sin CSP/HSTS y el rate-limit contaría mal las IPs detrás del proxy.
- **No verificado en vivo:** no pude confirmar el `NODE_ENV` real del servidor de staging con las herramientas disponibles. **Debe confirmarse en el servidor antes de nada.**
- **Recomendación:** (a) Garantizar `NODE_ENV=production` y `AUTH_TRUST_HEADERS=false` en el servidor. (b) Mejor aún: cambiar la lógica para que la coraza sea "segura por defecto" salvo que se pida explícitamente modo dev (no depender de la coincidencia exacta de la cadena `production`). (c) Que `validateEnvironment()` también rechace arrancar con trusted-headers en cualquier entorno accesible desde internet.

### C-04 · Secretos reales activos en `.env` (rotar)
- **Severidad:** Crítico (operacional)
- **Ubicación:** `.env`
- **Evidencia:** El `.env` contiene la **service-role key** de Supabase (bypassa RLS = acceso total a la DB), `SUPABASE_DB_PASSWORD` y `STAGING_AUTH_PASSWORD` en claro. Verifiqué que `.env` **no** está en git (`.gitignore` lo cubre y `git ls-files` no lo lista) — bien. Pero son secretos vivos y de alto poder presentes en el sistema de archivos.
- **Riesgo real:** Quien obtenga la service-role key controla toda la base de datos saltándose RBAC y RLS.
- **Recomendación:** Tratar estas claves como potencialmente expuestas y **rotarlas** (service-role, password de DB, password de staging). Gestionarlas solo por el gestor de secretos de Coolify, nunca en un `.env` de trabajo compartido. Confirmar que ningún `.env` real viva en la imagen Docker (el `Dockerfile` no lo copia — correcto).

---

## C. Hallazgos importantes no críticos

### H-01 · `xlsx` (SheetJS) con vulnerabilidades altas y sin fix
- **Severidad:** Alto
- **Ubicación:** `package.json` → `xlsx@^0.18.5` (dependencia de runtime)
- **Evidencia:** `npm audit`: Prototype Pollution (GHSA-4r6h-8v6p-xvw6) y ReDoS (GHSA-5pgg-2g8v-p4x9). "No fix available".
- **Riesgo:** Si se **parsea** un archivo Excel subido por un usuario, hay riesgo de prototype pollution/ReDoS. Si solo se **genera** para exportar, el riesgo es menor.
- **Recomendación:** Confirmar si se importan XLSX de usuarios. Migrar a `exceljs` para lectura, o aislar el parseo. Si solo se exporta, documentar el riesgo residual.

### H-02 · Vulnerabilidades en toolchain de dev (vitest/vite/esbuild/form-data)
- **Severidad:** Moderado (bajo en runtime de producción)
- **Ubicación:** devDependencies (`vitest` crítico, `vite`/`esbuild` altos/moderados, `form-data` vía `supertest`)
- **Evidencia:** `npm audit`. La imagen de producción usa `npm ci --omit=dev`, así que estas no se embarcan en runtime.
- **Riesgo:** Afecta sobre todo entornos de desarrollo/CI (p. ej. dev server de esbuild/vite). No es la superficie de producción.
- **Recomendación:** Actualizar Vite/Vitest en una ventana controlada (posible breaking en Vite 6→7). Prioridad menor que C-01..C-04.

### H-03 · Token de sesión en `localStorage`
- **Severidad:** Medio
- **Ubicación:** `src/lib/authSession.ts:24-31` (`nugacore_access_token`)
- **Evidencia:** El access token de Supabase se guarda en `localStorage`.
- **Riesgo:** Si hay un XSS, el token es exfiltrable. La CSP de producción lo mitiga (`script-src 'self'`), pero solo si C-03 garantiza que la CSP está activa.
- **Recomendación:** Preferir cookies `HttpOnly`+`Secure`+`SameSite` para el token, o al menos asegurar CSP estricta en producción y minimizar la vida del token.

### H-04 · CSP permite `style-src 'unsafe-inline'`
- **Severidad:** Bajo/Medio
- **Ubicación:** `backend/common/http-security.ts:73`
- **Evidencia:** `style-src: 'self' 'unsafe-inline'` por el uso de `style={{}}` en componentes.
- **Riesgo:** Reduce la protección de CSP frente a inyección de estilos. `script-src` sí es estricto, así que el riesgo real es bajo.
- **Recomendación:** Aceptable a corto plazo; a futuro migrar estilos inline a clases y endurecer.

### H-05 · Payload y superficie: sin límite de tamaño de subida de archivos verificado
- **Severidad:** Bajo/Medio
- **Ubicación:** `backend/app.ts:20` (JSON limitado a 100kb — bien). Subida de archivos: no localizada en la auditoría.
- **Recomendación:** Confirmar que cualquier subida (documentos de cliente, imports) tenga límite de tamaño, validación de tipo y no permita path traversal en el nombre.

---

## D. Problemas de estabilidad o calidad

- **Build en el árbol de trabajo montado falla por EPERM** al vaciar `dist/` (no puede borrar el `dist/` existente). Es un artefacto del entorno de auditoría, **no** un fallo de código: el build es correcto en directorio limpio y en Docker (imagen fresca). Recomendación: `npm run clean` antes de build local, o dejar que Docker lo maneje.
- **Basura en el repo de trabajo:** ~25 archivos `vitest.config.ts.timestamp-*.mjs` y un `.tmp_claude_debug.log` de 1.1 MB (ambos gitignored). Limpieza recomendada.
- **104 warnings de ESLint** (`no-explicit-any`, casi todos en tests). No bloquean, pero conviene reducir el `any` en el código de dominio.
- **Chunk del frontend > 500 kB** (`index-*.js` 505 kB / 135 kB gzip). Considerar code-splitting con `import()` dinámico para el arranque.
- **Cobertura:** hay 1.827 tests (muy bien), pero conviene confirmar que existan pruebas específicas para: webhook manual sin firma (C-01), acceso no autenticado a GIS (C-02) y comportamiento de auth cuando `NODE_ENV≠production` (C-03). Hoy esos huecos no están cubiertos por un test que los prevenga.

---

## E. Checklist de producción

| Punto | Estado | Nota |
|---|---|---|
| Auth segura | **PARTIAL** | JWT Supabase sólido, pero C-03 (trusted-headers) puede anularla según entorno |
| Roles/permisos | **PARTIAL** | RBAC consistente salvo GIS (C-02) |
| Validación backend | **PARTIAL** | Coerción de tipos y `express.json` limitado; falta validación por schema formal (Zod/DTO) |
| CORS | **PASS** | Allowlist por env, niega cross-origin sin lista |
| Rate limit | **PARTIAL** | Configurado; efectividad depende de `trust proxy` (ligado a C-03) |
| Headers de seguridad | **PARTIAL** | helmet/HSTS/CSP solo si `NODE_ENV=production` (C-03) |
| HTTPS | **PASS** | Staging responde por HTTPS (Coolify/proxy). Verificar redirección HTTP→HTTPS en el proxy |
| Secrets protegidos | **PARTIAL** | No en git, pero secretos vivos en `.env`; rotar (C-04) |
| Logs seguros | **PASS** | Redacción central de secretos (`secret-redaction.ts`) |
| Backups | **NOT FOUND** | Existe `backup_policy` en DB, pero no se verificó estrategia real de backups de Supabase |
| Health checks | **PASS** | `/api/health/live` responde `{"status":"ok"}`; Docker HEALTHCHECK presente |
| Tests | **PASS** | 1827 passed / 49 skipped |
| Build | **PASS** | Correcto en directorio limpio |
| DB segura | **PASS** | RLS deny-by-default en todas las tablas; acceso solo por service-role en backend |
| Deploy reproducible | **PASS** | Dockerfile multistage + compose; imagen mínima `--omit=dev`, usuario no-root |
| Monitoreo | **PARTIAL** | Logs estructurados JSON; sin métricas/alertas externas verificadas |
| Auditoría | **PARTIAL** | `audit_logs`, `mikrotik_command_audit`, `security-audit.ts` existen; falta confirmar cobertura de acciones sensibles (pagos, suspensión) |
| Rollback | **PARTIAL** | `restart: unless-stopped`; sin estrategia de rollback de imagen/migraciones documentada |

---

## F. Comandos ejecutados y resultados

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc --noEmit` x2) | **PASS**, exit 0 |
| `npx eslint .` | **PASS**, 0 errores, 104 warnings |
| `npm test` (vitest run) | **PASS**, 1827 passed, 49 skipped, 153 files |
| `npm run build` (árbol montado) | **FAIL** por `EPERM unlink dist/...` (permiso del FS montado, no del código) |
| `npm run build` (copia en dir limpio) | **PASS**, `dist/server.cjs` 657 kB, front 505 kB |
| `npm audit` | 8 vulns: 1 crítica (vitest), 3 altas (xlsx, vite, form-data), 4 moderadas (esbuild, vite-node, @vitest/mocker, protobufjs) |
| `git ls-files \| grep .env` | Solo `.env.example`, `.env.production.example` (los reales NO están en git) |
| Revisión RLS migraciones | RLS `ENABLE` en todas las tablas de `public`; **0** `CREATE POLICY` (deny-by-default intencional) |
| Fetch `GET /api/health/live` (vivo) | `{"status":"ok"}` |
| Fetch `GET /api/gis/*`, `/api/auth/me` (vivo) | Respondieron sin error, pero la herramienta no renderiza cuerpos JSON ni headers → verificación en vivo **limitada** |

---

## G. Plan de corrección por fases

**Fase 0 — Bloqueadores críticos (antes de publicar):**
1. C-01: proteger `/api/payments/webhook/manual` (firma/token obligatorio o RBAC de operador).
2. C-02: añadir `requireRoles(READ_ROLES)` a las rutas de datos de `/api/gis/*`.
3. C-03: confirmar en el servidor `NODE_ENV=production` y `AUTH_TRUST_HEADERS=false`; endurecer la lógica para que la coraza sea segura por defecto y que el fail-fast rechace trusted-headers en internet.
4. C-04: rotar service-role key, password de DB y password de staging; moverlos al gestor de secretos de Coolify.

**Fase 1 — Seguridad mínima de producción:**
5. Añadir validación por schema (Zod/DTO) en endpoints de escritura (pagos, billing, suspensión, inventory).
6. H-01: decidir estrategia para `xlsx` (aislar parseo o migrar a `exceljs`).
7. Verificar redirección HTTP→HTTPS y HSTS efectivos en el proxy.
8. H-03: mover el token a cookie `HttpOnly` o garantizar CSP estricta viva en prod.

**Fase 2 — Estabilidad y observabilidad:**
9. Métricas + alertas (errores 5xx, rate-limit, latencia). Confirmar auditoría de acciones sensibles.
10. Definir y probar estrategia de backups de Supabase y rollback de imagen/migraciones.
11. Limpieza del repo (timestamps de vitest, debug log), reducir `any`.

**Fase 3 — Hardening avanzado:**
12. Actualizar toolchain (Vite/Vitest) resolviendo vulns de dev.
13. Endurecer CSP (`style-src`), code-splitting del frontend, límites de subida de archivos.
14. Pentest dirigido a auth, pagos, suspensión y provisioning MikroTik.

**Fase 4 — Pruebas finales y aprobación:**
15. Tests de regresión para C-01, C-02, C-03. Re-ejecutar typecheck/lint/test/build/audit.
16. Prueba de humo en staging con `NODE_ENV=production` real, verificando headers en vivo (con Chrome conectado o `curl -I`).
17. Aprobación de Hermes sobre staging.

---

## H. Criterio final

- **¿Está listo para internet?** **No todavía.**
- **¿Qué bloquea la salida a producción?** Cuatro cosas: (1) el webhook de pago manual sin firma, (2) los endpoints GIS sin autenticación, (3) la dependencia de la coraza en `NODE_ENV` exacto junto con `AUTH_TRUST_HEADERS=true` en el `.env`, y (4) los secretos vivos que hay que rotar y mover a un gestor.
- **¿Qué corregir primero?** En orden: C-01 (webhook), C-03 (confirmar/endurecer entorno y trusted-headers), C-02 (GIS), C-04 (rotar secretos).
- **¿Qué pruebas finales ejecutar antes de publicar?** `npm run typecheck && npm run lint && npm test && npm run build` en verde; `npm audit` revisado; verificación en vivo (con Chrome/`curl -I`) de que en el servidor real: responde HSTS+CSP, `/api/gis/*` y el webhook manual exigen auth/firma, un header `x-user-role` NO otorga rol, y `NODE_ENV=production`.

---

*Este reporte es solo auditoría. No se modificó ningún archivo del proyecto. Dime qué hallazgos quieres que corrija y en qué orden, y preparo los cambios respetando las reglas del proyecto (tests, typecheck, build, compatibilidad, sin routers reales, sin activar `MIKROTIK_WORKER_LIVE` ni commit mode, auditable por Hermes).*
