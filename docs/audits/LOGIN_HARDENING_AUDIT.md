# LOGIN HARDENING AUDIT — Fase 4.3.1

Fecha: 2026-06-04
Alcance: auditoría (sin modificar) de la superficie de login para cerrar los
hallazgos menores reportados por Hermes antes de aprobar Fase 4.3 a producción.
No se toca Billing, MikroTik, Suspensiones, Reportes, Inventory, GIS ni Tickets.

## 1. Componentes localizados

| Archivo | Rol en el login |
|---|---|
| `src/components/LoginForm.tsx` | Formulario de acceso (Supabase signInWithPassword) + panel "Acceso Rápido" + recuperación de contraseña. |
| `src/components/LandingPage.tsx` | Página pública. Botones "Demo 1-Clic" e "Instancias Demo Rápido". |
| `src/lib/supabase.ts` | Cliente Supabase + `MOCK_USER_PROFILES` (perfiles demo) + `normalizeUserRole`. |
| `src/lib/authSession.ts` | Persistencia de sesión (localStorage) + perfil canónico desde `/api/auth/me`. **Limpio**, sin credenciales. |
| `src/App.tsx` | Cableado: `onInstantDemo(profile) => handleLoginSuccess(profile)`. |

## 2. Dónde están los quick logins

- **LoginForm** (`src/components/LoginForm.tsx:280-323`): 4 botones de "Acceso Rápido" que llaman `handleAutoFill(mockEmail)`.
- **LandingPage** (`src/components/LandingPage.tsx:113,159,564,580,596,612`): botones "Demo Admin (1-Clic)" / "Instancias Demo Rápido" que llaman `handleQuickDemoClick(roleEmail)` → `onInstantDemo(profile)`.

## 3. Qué correos usan

Todos usan dominio **demo `@nugacorp.com`** (no son los usuarios reales de staging):
- `admin@nugacorp.com` (Super Admin)
- `cobranza@nugacorp.com` (Cobranza)
- `tecnico@nugacorp.com` (Técnico)
- `soporte@nugacorp.com` (Soporte)

Los usuarios **reales de staging** son distintos (`@staging.nugacore.local`, ver [STAGING_AUTH_USERS.md](../deployment/STAGING_AUTH_USERS.md)) → confusión entre demo y staging confirmada (hallazgo #3 de Hermes).

## 4. Qué passwords usan / autofill hardcodeado

- **`src/components/LoginForm.tsx:41`** — `handleAutoFill` hace `setPassword('nugacorp_secure_pwd2026')`.
  → **CREDENCIAL EMBEBIDA / PASSWORD HARDCODEADO EN FRONTEND.** Queda incrustado en el bundle JS público (`dist/assets/index-*.js`). **Hallazgo crítico.**

## 5. Usuarios demo / credenciales embebidas

- **`src/lib/supabase.ts:51-84`** — `MOCK_USER_PROFILES`: 4 perfiles demo con `id` UUID fijos, emails `@nugacorp.com`, nombres, teléfonos y `avatar_url`. Datos ficticios embebidos en el cliente.

## 6. Hallazgo crítico adicional (bypass de autenticación)

- **`src/components/LandingPage.tsx:70-75` + `src/App.tsx:498-500`**:
  `handleQuickDemoClick` → `onInstantDemo(profile)` → `handleLoginSuccess(profile)`
  **sin password, sin Supabase, sin access token.**
  Cualquier visitante de la landing **pública** puede pulsar "Demo Admin (1-Clic)" y entrar al frontend como **Super Admin**. El backend rechaza las llamadas API (sin Bearer), pero el frontend concede la UI completa de Super Admin.
  → **BYPASS DE LOGIN. Hallazgo crítico — debe eliminarse para producción.**

- **`src/components/LoginForm.tsx:88-101`** (modo preview sin Supabase): inicia sesión con `MOCK_USER_PROFILES` validando **solo el email, sin password**. Es otra vía de login sin contraseña (dead code en staging/prod porque ahí Supabase está configurado, pero presente en el bundle).

## 7. ¿Hay JWT/tokens embebidos en frontend?

No se encontraron JWT ni tokens de servicio embebidos. Las claves del cliente son
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (anon key, pública por diseño, inyectada
en build-time). El `SUPABASE_SERVICE_ROLE_KEY` vive solo en backend. ✓

## 8. Cache busting (contexto del hallazgo #4 de Hermes)

- **Vite** genera nombres de assets con hash de contenido (`index-DrNV2uMR.js`, `index-B4NP0NIs.css`). ✓ Invalidación de bundle correcta por nombre.
- **`server.ts:20-26`** sirve `dist/` con `express.static(distPath)` **sin opciones de cache** y un catch-all `res.sendFile(index.html)` **sin headers de cache**.
  → `index.html` se entrega sin `Cache-Control` explícito; un proxy/navegador puede servir un `index.html` viejo que apunta a hashes de assets ya inexistentes tras el deploy → **pantalla en blanco / bundle stale**. Falta:
  - `Cache-Control: no-cache` en `index.html` (siempre revalidar).
  - `Cache-Control: public, max-age=1y, immutable` en `/assets/*` (hasheados).
- **Dockerfile**: build multistage correcto; `VITE_*` por build args. No interviene en cache headers.

## 9. Resumen de hallazgos

| # | Severidad | Hallazgo | Ubicación |
|---|---|---|---|
| 1 | **Crítico** | Password hardcodeado en autofill | `LoginForm.tsx:41` |
| 2 | **Crítico** | Bypass de login (demo 1-clic sin auth) | `LandingPage.tsx:70` + `App.tsx:498` |
| 3 | Medio | Login sin password en modo preview | `LoginForm.tsx:88-101` |
| 4 | Medio | Usuarios/correos demo `@nugacorp.com` (confusión con staging) | `supabase.ts:51`, `LoginForm.tsx`, `LandingPage.tsx` |
| 5 | Medio | `index.html` sin política de cache → bundle stale tras deploy | `server.ts:20-26` |
| 6 | Bajo | Placeholders y footer con `@nugacorp.com` | varios (cosmético, se conservan como placeholders genéricos) |

## 10. Plan de corrección (Tareas 2–4)

1. **Eliminar** el password hardcodeado: el autofill solo rellena el **email**, nunca el password.
2. **Eliminar** el bypass `onInstantDemo`: los botones de la landing enrutan al login real.
3. **Eliminar** `MOCK_USER_PROFILES` y el login-sin-password de preview.
4. **Quick login (decisión Tarea 3 = Opción B reforzada)**: mantener accesos rápidos que **solo prerellenan el email** de los usuarios de staging `@staging.nugacore.local` (sin passwords), **gateados** por `VITE_ENABLE_QUICK_LOGIN` (apagado por defecto → producción no los muestra). Requieren contraseña real vía Supabase.
5. **Cache busting**: en `server.ts`, `no-cache` para `index.html` y `immutable 1y` para `/assets/*`.
