# NugaCore — Autenticación real (Fase 2)

> Última actualización: 2026-06-03 · Objetivo: **eliminar la dependencia de `AUTH_TRUST_HEADERS`** y dejar la identidad basada en **JWT de Supabase**, con roles/permisos desde la base de datos.
> Sin tocar UI, sin cambiar contratos de API, sin migrar otros módulos, sin tocar Customers/Billing.

---

## 1. Qué ya existía (no se modificó visualmente)

El **frontend ya hacía auth real con Supabase** (`src/components/LoginForm.tsx`, `src/lib/authSession.ts`, `src/App.tsx`):
- **Login**: `supabase.auth.signInWithPassword` → lee perfil + rol de `users_profile`/`user_roles`.
- **Logout**: `supabase.auth.signOut()`.
- **Recuperación**: `supabase.auth.resetPasswordForEmail`.
- **Restauración de sesión**: `restoreSessionProfileFromSupabase()` al arrancar.
- **Refresh**: lo gestiona `supabase-js` (autoRefreshToken).

## 2. Qué cambió en Fase 2

### 2.1 Backend — `backend/common/auth-context.ts` (núcleo)
Nueva regla de identidad:
```
computeAllowTrustedHeaders(production, AUTH_TRUST_HEADERS, supabaseConfigured)
  → producción: SIEMPRE false (JWT-only, sin excepciones)
  → desarrollo: AUTH_TRUST_HEADERS || !supabaseConfigured
```
- En **producción**, los `x-user-role`/`x-user-id` del cliente se **ignoran por completo**: la identidad sale de validar el **JWT de Supabase** (`supabaseAdmin.auth.getUser(token)`) y el rol se resuelve desde `public.user_roles`.
- En **dev/test**, los trusted-headers siguen disponibles como conveniencia (harness de pruebas y desarrollo sin usuarios reales).
- **Resultado:** `AUTH_TRUST_HEADERS=true` ya **no puede** debilitar producción → dependencia eliminada.

### 2.2 Frontend — solo lógica (sin cambios visuales)
- `src/App.tsx`: `getAuthHeaders` ahora obtiene el **token fresco** de `supabase.auth.getSession()` antes de cada request, para que el refresh automático de Supabase evite 401 tras ~1 h. No se modificó markup/estilos/componentes.

### 2.3 Datos — usuarios de staging
- `scripts/seed-staging-auth.mjs`: crea usuarios **ficticios** (uno por rol) en Supabase Auth + `users_profile` + `user_roles`. Usa la **service-role key** (no el PAT) y `STAGING_AUTH_PASSWORD` (no hardcodeado). Idempotente.

---

## 3. Roles y permisos

Roles (en `public.roles`, ya sembrados): **Super Admin, Administrador, Cobranza, Técnico, Soporte, Solo lectura**.

- El rol se asigna en `public.user_roles` (1 usuario → 1+ roles; se usa el primero).
- RBAC por ruta: `requireRoles([...])` (backend/common/rbac.ts) y por acción: `requireAction('key')` (backend/common/action-permissions.ts).
- Matriz de permisos por acción reflejada en `public.role_permissions` (migración `rls_and_seeds`).

| Acción | Roles permitidos |
|--------|------------------|
| `reports.view` | todos |
| `reports.export` | super admin, administrador, cobranza, soporte |
| `automation.manage` | super admin, administrador |
| `automation.execute` | super admin, administrador, cobranza, técnico |
| `security.audit.read` | super admin, administrador |
| `security.backup.manage` | super admin, administrador |
| `security.permissions.read` | super admin, administrador, soporte |

---

## 4. Flujo de autenticación (producción)

```
Navegador (LoginForm) → supabase.auth.signInWithPassword → JWT (access_token)
        │  Authorization: Bearer <jwt>   (App.getAuthHeaders, token fresco)
        ▼
Express attachAuthContext
   → supabaseAdmin.auth.getUser(jwt)         (valida firma/expiración)
   → resolveRoleFromSupabase(userId)         (rol desde public.user_roles)
   → req.authContext = { userId, role, source:'supabase-jwt' }
        ▼
requireRoles / requireAction  → 401 si no hay contexto · 403 si rol insuficiente
```
> En producción, sin JWT válido no hay `authContext` → las rutas protegidas devuelven 401. Los `x-user-*` se ignoran.

---

## 5. Crear usuarios de auth (staging)

```bash
# En .env (gitignored): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAGING_AUTH_PASSWORD
node --env-file=.env scripts/seed-staging-auth.mjs
```
Crea (ficticios): `superadmin@`, `admin@`, `cobranza@`, `tecnico@`, `soporte@`, `lectura@` `nugacore.local`, cada uno con su rol. El password se define en `STAGING_AUTH_PASSWORD` (no se imprime ni se commitea).

> En producción, crea los usuarios reales en el Dashboard de Supabase (Authentication) y enlázalos en `users_profile`/`user_roles`, o adapta este script.

---

## 6. Variables de entorno relevantes

| Variable | Dev | Prod | Nota |
|----------|-----|------|------|
| `AUTH_TRUST_HEADERS` | `true` (opcional) | **se ignora** | En prod nunca habilita trusted-headers |
| `SUPABASE_URL` | staging | prod | Validación de JWT (server) |
| `SUPABASE_SERVICE_ROLE_KEY` | staging | prod | Solo backend; valida tokens + lee roles |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | staging | prod | Login del cliente |
| `STAGING_AUTH_PASSWORD` | sí (seed) | — | Solo para el seed de staging |

---

## 7. Pruebas

- `tests/unit/auth.middleware.test.ts`: `computeAllowTrustedHeaders` → **producción siempre JWT-only**.
- `tests/contract/auth.db.contract.test.ts` (skipIf sin Supabase/seed): login real → JWT → `/api/auth/me` resuelve rol desde DB (`source=supabase-jwt`); `solo lectura` recibe 403 en escritura; Bearer inválido nunca produce `source=supabase-jwt`.

---

## 8. Verificación manual (JWT-only)

Con el servidor en `AUTH_TRUST_HEADERS=false` + Supabase configurado:
- `POST /api/clients` con solo `x-user-role: super admin` (sin Bearer) → **401/403** (headers ignorados).
- `GET /api/auth/me` con `Bearer <jwt válido>` → 200 con rol correcto.

---

## 9. Riesgos / pendientes

| Tema | Severidad | Nota |
|------|:---------:|------|
| GET abiertos | 🟡 | Varios `GET` siguen sin RBAC (contrato v1). Endurecer lecturas sensibles es trabajo futuro (no cambia contratos ahora). |
| Sin rate-limit/helmet/CORS | 🟠 | Hardening HTTP pendiente (fase de seguridad/deploy). |
| Token en `localStorage` | 🟠 | XSS podría robarlo; evaluar cookies httpOnly más adelante. |
| Permisos finos | 🟡 | RBAC por rol/acción; aún no hay permisos por recurso/registro. |
| Provisioning de usuarios en prod | 🟡 | Falta flujo de alta de usuarios/asignación de roles desde la UI (no estaba en alcance). |

---

## 10. Siguiente paso sugerido

- Endurecer las lecturas `GET` sensibles (exigir auth) en una iteración que actualice el contrato de forma coordinada con el frontend.
- Añadir rate-limit + helmet + CORS (hardening) antes de exponer a producción.
- Continuar **Fase 3** (migrar `plans`, luego `billing`) reutilizando el patrón repository/service.
