# Plan de corrección seguro — NugaCore-v2

**Fecha:** 2026-07-08
**Base:** `REPORTE_AUDITORIA_SEGURIDAD_2026-07-08.md`
**Estado:** Propuesta. **No se ha modificado ningún archivo.** Espero tu autorización para el primer commit.
**Reglas respetadas en todo el plan:** no romper contratos API, siempre agregar tests, siempre typecheck + build, compatibilidad hacia atrás, seguridad primero, no activar `MIKROTIK_WORKER_LIVE`, no activar commit mode, no usar routers reales, cada fase auditable por Hermes, migraciones idempotentes, soporte store+DB por feature flags.

---

## 1. Hallazgos ordenados por prioridad real de producción

### Nivel 1 — Compromete seguridad (bypass de auth / fraude)
| # | Hallazgo | Ubicación | Por qué es Nivel 1 |
|---|---|---|---|
| C-01 | Webhook de pago manual sin firma ni auth | `backend/domains/payments/routes.ts:159`, `providers/manual.provider.ts:32` | Endpoint público que aprueba pagos y reactiva servicio sin credenciales |
| C-03 | Coraza atada a `NODE_ENV==='production'` exacto + `AUTH_TRUST_HEADERS=true` | `common/http-security.ts:47`, `common/auth-context.ts:21-34`, `config/env.ts:39`, `.env` | Un header `x-user-role` podría dar super admin si el entorno no es exactamente `production` |
| C-04 | Secretos reales vivos (rotar) | `.env` | La service-role key bypassa RLS = control total de la DB |

### Nivel 2 — Puede filtrar datos
| # | Hallazgo | Ubicación | Por qué es Nivel 2 |
|---|---|---|---|
| C-02 | Endpoints GIS sin RBAC | `backend/domains/gis/routes.ts` | Expone PII de clientes y topología; hoy demo, real al activar `USE_DB_GIS` |
| H-03 | Token de sesión en `localStorage` | `src/lib/authSession.ts:24-31` | Exfiltrable ante XSS |
| H-05 | Subida de archivos sin límites/validación confirmados | (sin localizar) | Posible fuga/abuso si existe subida |

### Nivel 3 — Puede romper producción
| # | Hallazgo | Ubicación | Por qué es Nivel 3 |
|---|---|---|---|
| C-03b | Rate-limit depende de `trust proxy` (ligado a C-03) | `common/http-security.ts:52,107` | Detrás de proxy sin `trust proxy` el rate-limit cuenta mal las IPs → bloqueos o inefectividad |
| H-01 | `xlsx` con prototype pollution + ReDoS | `package.json` | Si se parsean XLSX de usuario, DoS/pollution en runtime |
| N-01 | Validación por schema ausente en escrituras | rutas de pagos/billing/suspension/inventory | Entrada malformada puede provocar 500 o estados corruptos |
| N-02 | Redirección HTTP→HTTPS / HSTS efectivos no verificados | proxy Coolify | — |

### Nivel 4 — Calidad y mantenibilidad
| # | Hallazgo | Ubicación |
|---|---|---|
| H-02 | Vulns de toolchain dev (vitest/vite/esbuild) | devDependencies |
| H-04 | CSP `style-src 'unsafe-inline'` | `common/http-security.ts:73` |
| Q-01 | Basura en repo (timestamps vitest, `.tmp_claude_debug.log`) | raíz |
| Q-02 | 104 warnings ESLint (`no-explicit-any`) | tests y algunos dominios |
| Q-03 | Chunk frontend > 500 kB | build Vite |
| Q-04 | Backups / rollback / monitoreo no formalizados | infra |

---

## 2. Propuesta de implementación por commits pequeños

> Filosofía: cada commit es **atómico, reversible y auditable por Hermes**. Los de seguridad primero. Ninguno cambia contratos de API (solo añaden guards/validación o endurecen config). Cada uno agrega tests y pasa `typecheck + lint + test + build`.

### Commit 1 — Proteger el webhook de pago manual (C-01)
- **Objetivo:** que `/api/payments/webhook/manual` exija un secreto compartido obligatorio; sin `WEBHOOK_SECRET_MANUAL` configurado, el endpoint rechaza (fail-closed).
- **Archivos:** `backend/domains/payments/providers/manual.provider.ts` (implementar verificación real por token/HMAC), `backend/domains/payments/routes.ts` (asegurar propagación del secret), `.env.example` y `.env.production.example` (documentar `WEBHOOK_SECRET_MANUAL`), `tests/` (nuevo test de contrato).
- **Riesgo:** Bajo-medio. Cambia comportamiento del endpoint manual (de "siempre válido" a "requiere secreto"). Contrato de ruta sin cambios; sí cambia validación. Mitigar coordinando el secreto con quien invoque el webhook manual.
- **Pruebas requeridas:** webhook manual sin secreto → 400/401; con secreto correcto → procesa; con secreto incorrecto → rechaza; idempotencia intacta.
- **Comando de validación:** `npm run typecheck && npm test -- payments && npm run build`
- **Criterio de aceptación:** ningún POST sin secreto válido aprueba pago ni reactiva servicio; tests nuevos en verde; sin regresión en mercadopago/openpay.

### Commit 2 — Endurecer entorno y trusted-headers (C-03)
- **Objetivo:** que la seguridad sea "segura por defecto": trusted-headers **nunca** activos en un entorno accesible desde internet y `validateEnvironment()` rechace arrancar si detecta esa combinación peligrosa; no depender de la igualdad exacta `NODE_ENV==='production'`.
- **Archivos:** `backend/common/auth-context.ts` (`computeAllowTrustedHeaders`), `backend/config/env.ts` (`validateEnvironment` + noción de "entorno expuesto", p. ej. `APP_ENV`/`PUBLIC_DEPLOYMENT`), `backend/common/http-security.ts` (activar helmet/HSTS/CSP/trust-proxy por "expuesto", no por string exacto), `tests/`.
- **Riesgo:** Medio. Toca el núcleo de auth y arranque. Mitigar con tests exhaustivos de la matriz (dev local / staging expuesto / producción) y sin cambiar el flujo JWT.
- **Pruebas requeridas:** en entorno expuesto, header `x-user-role` NO otorga rol; fail-fast lanza si `AUTH_TRUST_HEADERS=true` en expuesto; en dev local sigue funcionando el atajo; JWT válido sigue autenticando.
- **Comando de validación:** `npm run typecheck && npm test -- auth && npm run build`
- **Criterio de aceptación:** imposible obtener rol por header en un despliegue público; el proceso no arranca con la config insegura; sin romper dev.

### Commit 3 — RBAC en endpoints GIS (C-02)
- **Objetivo:** exigir `requireRoles(READ_ROLES)` en las rutas de datos GIS; dejar solo `/api/gis/health` público.
- **Archivos:** `backend/domains/gis/routes.ts`, `tests/` (contrato: 401 sin token, 200 con rol).
- **Riesgo:** Bajo. Añade guard donde no había; el frontend ya envía Bearer en llamadas autenticadas. Verificar que el mapa del front pase token.
- **Pruebas requeridas:** `/api/gis/map-data|customers|towers` sin token → 401; con `READ_ROLES` → 200; `/api/gis/health` sigue público.
- **Comando de validación:** `npm run typecheck && npm test -- gis && npm run build`
- **Criterio de aceptación:** ningún dato GIS accesible sin auth; consistencia con los demás dominios; sin regresión en el mapa.

### Commit 4 — Rotación de secretos (C-04) *(operativo, no código)*
- **Objetivo:** rotar service-role key, `SUPABASE_DB_PASSWORD` y `STAGING_AUTH_PASSWORD`; moverlos al gestor de secretos de Coolify; sacar el `.env` real de cualquier carpeta compartida.
- **Archivos:** ninguno de código. Documentar en `docs/` el procedimiento y actualizar `.env.example` si aplica.
- **Riesgo:** Medio operativo (rotar la service-role key puede cortar el backend hasta redeploy con la nueva). Coordinar ventana.
- **Pruebas requeridas:** tras rotar, smoke test de `/api/health/live`, login real y una lectura autenticada.
- **Comando de validación:** verificación en vivo post-rotación (Chrome/`curl -I` con extensión conectada).
- **Criterio de aceptación:** claves viejas revocadas; app funcional con las nuevas; ningún secreto en `.env` de trabajo compartido.

### Commit 5 — Validación por schema en escrituras (N-01)
- **Objetivo:** añadir validación de entrada (Zod o validadores existentes en `backend/common/validators.ts`) a endpoints de escritura de pagos, billing, suspensión e inventory, devolviendo 400 consistente sin filtrar internals.
- **Archivos:** `backend/common/validators.ts`, rutas de los dominios citados, `tests/`.
- **Riesgo:** Medio. Debe rechazar solo lo inválido sin romper payloads legítimos → mantener compatibilidad hacia atrás. Empezar en modo estricto solo para campos claramente requeridos.
- **Pruebas requeridas:** payload válido → OK; faltantes/tipos malos → 400 con `code`; sin cambio en respuestas de éxito.
- **Comando de validación:** `npm run typecheck && npm test && npm run build`
- **Criterio de aceptación:** entradas malformadas ya no producen 500; contratos de éxito intactos.

### Commit 6 — Estrategia para `xlsx` (H-01)
- **Objetivo:** eliminar el riesgo de parseo inseguro: aislar/validar el import de XLSX o migrar la lectura a `exceljs`; si solo se exporta, documentar riesgo residual y fijar versión.
- **Archivos:** módulo(s) que usen `xlsx`, `package.json`, `tests/`.
- **Riesgo:** Medio (posible breaking si se cambia de librería). Decidir primero lectura vs solo escritura.
- **Pruebas requeridas:** generación/lectura de XLSX sigue correcta; test con archivo malformado no cuelga ni contamina prototipos.
- **Comando de validación:** `npm run typecheck && npm test && npm run build && npm audit`
- **Criterio de aceptación:** `npm audit` sin la vuln alta de xlsx en runtime, o riesgo aislado y documentado.

### Commit 7 — Token en cookie HttpOnly o CSP garantizada (H-03/H-04)
- **Objetivo:** reducir superficie XSS: mover el access token a cookie `HttpOnly`+`Secure`+`SameSite`, o —mínimo— garantizar CSP estricta viva en prod (depende de Commit 2) y endurecer `style-src`.
- **Archivos:** `src/lib/authSession.ts`, backend de auth/me si se emite cookie, `common/http-security.ts`, `tests/`.
- **Riesgo:** Medio-alto (cambia el manejo de sesión en el front). Hacerlo tras Commit 2. Puede requerir ajustes de CORS/credentials.
- **Pruebas requeridas:** login/logout/refresh funcionan; token no accesible por JS si va a cookie; CSP presente en prod.
- **Comando de validación:** `npm run typecheck && npm test && npm run build`
- **Criterio de aceptación:** sesión robusta ante XSS; sin regresión de login.

### Commit 8 — Infra: HTTP→HTTPS, backups, rollback, monitoreo (N-02/Q-04)
- **Objetivo:** documentar y activar redirección HTTP→HTTPS y HSTS en el proxy, backups de Supabase, procedimiento de rollback de imagen/migraciones y monitoreo básico (5xx, rate-limit, latencia).
- **Archivos:** `docs/`, config de Coolify/compose (sin secretos).
- **Riesgo:** Bajo (mayormente config/documentación).
- **Pruebas requeridas:** verificación en vivo de redirección y HSTS; prueba de restore de backup en entorno aislado.
- **Comando de validación:** verificación en vivo (`curl -I`/Chrome) + checklist de runbook.
- **Criterio de aceptación:** HTTPS forzado, backups probados, rollback documentado, alertas mínimas activas.

### Commit 9 — Calidad y limpieza (H-02/Q-01/Q-02/Q-03)
- **Objetivo:** limpiar basura del repo, reducir `any`, code-splitting del frontend, y actualizar toolchain de dev en ventana controlada.
- **Archivos:** raíz (limpieza), configs de Vite, tests, `package.json`.
- **Riesgo:** Bajo-medio (update de Vite/Vitest puede ser breaking → aislar en su propio commit).
- **Pruebas requeridas:** suite completa en verde tras cada cambio.
- **Comando de validación:** `npm run lint && npm run typecheck && npm test && npm run build && npm audit`
- **Criterio de aceptación:** repo limpio, warnings reducidos, arranque del front más ligero, vulns de dev resueltas.

---

## 3. Orden recomendado y dependencias

```
Commit 1 (C-01) ─┐
Commit 2 (C-03) ─┼─ Nivel 1 (seguridad) → primero
Commit 4 (C-04) ─┘   (Commit 4 es operativo, coordinar ventana)
Commit 3 (C-02) ──── Nivel 2 (fuga de datos)
Commit 7 (H-03) ──── depende de Commit 2 (CSP)
Commit 5 (N-01) ─┐
Commit 6 (H-01) ─┼─ Nivel 3 (estabilidad)
Commit 8 (N-02) ─┘
Commit 9 (calidad) ─ Nivel 4 (último)
```

Cada commit se valida con Hermes en staging antes del siguiente.

---

## 4. Primer commit recomendado

**Commit 1 — Proteger el webhook de pago manual (C-01).**

Motivo: es el hallazgo de mayor impacto y menor superficie de cambio — un endpoint público hoy permite aprobar pagos y reactivar servicio sin credenciales. El cambio es acotado (proveedor manual + un test), no toca el contrato de la ruta, es fácil de revisar y de revertir, y no depende de ningún otro commit. Cierra un riesgo de fraude de inmediato.

Alcance exacto propuesto para el Commit 1:
- Implementar verificación real en `manual.provider.ts` (secreto obligatorio; fail-closed si falta).
- Documentar `WEBHOOK_SECRET_MANUAL` en `.env.example` / `.env.production.example`.
- Agregar test de contrato (sin secreto → rechazo; con secreto → procesa; idempotencia intacta).
- Validar con `npm run typecheck && npm test -- payments && npm run build`.

---

**No tocaré el código hasta tu autorización.** ¿Quieres que empiece por el Commit 1 tal como está descrito, o prefieres reordenar algo primero?
