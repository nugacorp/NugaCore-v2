# LOGIN HARDENING — RESULTADO (Fase 4.3.1)

Fecha: 2026-06-04
Objetivo: cerrar los hallazgos menores de Hermes para aprobar Fase 4.3 a
producción. Sin nuevas funcionalidades, sin rediseño visual. No se tocó
Billing, MikroTik, Suspensiones, Reportes, Inventory, GIS ni Tickets.

Auditoría previa: [LOGIN_HARDENING_AUDIT.md](LOGIN_HARDENING_AUDIT.md).

## 1. Resumen ejecutivo

Se eliminaron del frontend: un **password hardcodeado**, un **bypass de
autenticación** (demo 1-clic que entraba como Super Admin sin credenciales),
los **perfiles/usuarios demo** `@nugacorp.com` y el **login-sin-password** del
modo preview. El quick login se reemplazó por un panel **gateado** que solo
prerellena el **email** de los usuarios de staging (sin passwords). Se corrigió
el **cache busting**: `index.html` sin cache, assets hasheados inmutables.

## 2. Decisión de quick login (Tarea 3)

**Opción elegida: B reforzada + gate.** Se mantienen accesos rápidos PERO:
- Usan exclusivamente los emails de staging `@staging.nugacore.local`.
- **Nunca** muestran ni rellenan passwords (solo prefill de email; el operador teclea la contraseña real → Supabase auth).
- Están **gateados** por `VITE_ENABLE_QUICK_LOGIN` (apagado por defecto): el bundle de **producción no muestra ningún acceso rápido**.
- El "instant demo" que hacía bypass de auth se **eliminó por completo** (a esa parte se le aplicó la Opción A).

Es la alternativa más segura y a la vez profesional: conserva la comodidad de
Hermes en staging sin exponer credenciales ni permitir accesos sin autenticar.

## 3. Hallazgos encontrados → corregidos

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Password hardcodeado `nugacorp_secure_pwd2026` (autofill) | ✅ Eliminado; autofill solo setea email (`setPassword('')`). |
| 2 | Bypass de login: demo 1-clic sin auth (`onInstantDemo`) | ✅ Eliminado; los botones enrutan al login real. |
| 3 | Login sin password en modo preview (`MOCK_USER_PROFILES`) | ✅ Eliminado; sin Supabase configurado se muestra error, no se inicia sesión. |
| 4 | Usuarios/correos demo `@nugacorp.com` | ✅ Eliminados; quick login usa `@staging.nugacore.local`. |
| 5 | `index.html` sin política de cache → bundle stale tras deploy | ✅ `no-cache` en index.html; `immutable 1y` en `/assets/*`. |
| 6 | Placeholders/footer con `@nugacorp.com` | ✅ Cambiados a `example.com`. |

## 4. Archivos creados

- `docs/LOGIN_HARDENING_AUDIT.md`
- `docs/LOGIN_HARDENING_RESULT.md`
- `tests/unit/login.hardening.test.ts`

## 5. Archivos modificados

- `src/lib/supabase.ts` — fuera `MOCK_USER_PROFILES`; dentro `STAGING_QUICK_LOGINS` (emails, sin passwords) + `isQuickLoginEnabled` (gate `VITE_ENABLE_QUICK_LOGIN`).
- `src/components/LoginForm.tsx` — autofill email-only; removido login-sin-password; panel quick login gateado; placeholders/footer `example.com`.
- `src/components/LandingPage.tsx` — removido `onInstantDemo`/bypass; botones enrutan al login.
- `src/App.tsx` — `LandingPage` ya no recibe `onInstantDemo`.
- `server.ts` — headers de cache busting.
- `.env.example` / `.env.production.example` — `VITE_ENABLE_QUICK_LOGIN`.

## 6. Validación

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ sin errores |
| `npm test` | ✅ 166 passed / 32 skipped (14 nuevos en `login.hardening`) |
| `npm run build` | ✅ Vite + esbuild OK (assets hasheados) |

### Evidencia en el bundle de producción (`dist/assets/index-*.js`)

```
nugacorp_secure_pwd2026  -> NO presente
@nugacorp.com            -> NO presente
staging.nugacore.local   -> presente (solo emails, sin passwords)
```

## 7. Riesgos restantes

- **Anon key de Supabase** (`VITE_SUPABASE_ANON_KEY`) viaja en el bundle: es **público por diseño** (protegido por RLS). No es un secreto. Sin cambios.
- **Dev local sin Supabase**: ya no puede iniciar sesión (se eliminó el mock login). Es intencional para producción; configurar Supabase para desarrollar.
- **Quick login en staging**: si se habilita `VITE_ENABLE_QUICK_LOGIN=true`, los emails de staging quedan visibles en la UI (no los passwords). Aceptable para staging; debe quedar `false` en producción.
- **Proxy de Coolify**: el origin ya envía headers correctos; si hubiera un CDN intermedio se recomienda respetar `Cache-Control` del origin (no forzar cache de `index.html`).

## 8. Instrucciones exactas para Hermes (validación staging)

Pre-requisito: build de staging con `VITE_ENABLE_QUICK_LOGIN=true` y `VITE_SUPABASE_*` configurados.

1. **No-bypass**: abrir la landing pública sin sesión. Confirmar que "Demo 1-Clic" / tarjetas de rol **llevan al formulario de login** y **no** entran a la consola sin credenciales.
2. **Quick login seguro**: en el login, pulsar un acceso rápido → el campo email se rellena con `@staging.nugacore.local` y el **password queda vacío**. Escribir el password de staging → inicia sesión vía Supabase.
3. **Sin secretos**: descargar `dist/assets/index-*.js` (o DevTools → Sources) y buscar `nugacorp_secure_pwd2026` y `@nugacorp.com` → **0 coincidencias**.
4. **RBAC intacto**: validar que Cobranza puede gestionar Billing y Solo Lectura no (sin cambios respecto a 4.3).
5. **Cache busting**: tras un nuevo deploy, recargar con cache del navegador activa.
   - `curl -I https://<staging>/` → `Cache-Control: no-cache, no-store, must-revalidate` en el HTML.
   - `curl -I https://<staging>/assets/index-<hash>.js` → `Cache-Control: public, max-age=31536000, immutable`.
   - Confirmar que la app carga el bundle nuevo sin pantalla en blanco ni hard-refresh manual.
6. **Producción**: verificar que con `VITE_ENABLE_QUICK_LOGIN=false` (o ausente) **no aparece** ningún acceso rápido.

Criterio de aprobación: sin bypass, sin secretos en bundle, quick login solo-email gateado, cache busting correcto, RBAC sin regresión.

No se avanza a Fase 4.4.
