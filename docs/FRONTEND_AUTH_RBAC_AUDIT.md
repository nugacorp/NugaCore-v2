# NugaCore — Auditoría de Auth/RBAC del Frontend (Fase 2.2)

> Fecha: 2026-06-03 · Problema: el login real funciona y el **backend** resuelve bien el rol de cada usuario, pero en el **frontend todos ven los mismos módulos**.

---

## 1. Causa raíz

El frontend **NO** tomaba el rol del backend; lo resolvía **consultando Supabase directamente** desde el navegador (anon key):

- `src/components/LoginForm.tsx` → `supabase.from('users_profile').select('... user_roles ( roles ( name ) )').eq('id', user.id).single()`
- `src/lib/authSession.ts` → `restoreSessionProfileFromSupabase()` hace la misma consulta directa.

Pero el esquema tiene **RLS deny-by-default** (`supabase/migrations/20260531000001_rls_and_seeds.sql`: RLS habilitado en **todas** las tablas, **sin políticas** para `anon`/`authenticated`). Por lo tanto:

> La consulta directa del navegador a `users_profile`/`user_roles`/`roles` **devuelve vacío** (RLS la bloquea) → `profileError` → el código cae al **fallback `'Solo lectura'`** para **todos** los usuarios.

Resultado: aunque el backend (que usa la **service-role key**, que bypassa RLS) resuelve el rol correcto en `/api/auth/me`, el frontend asignaba a todos `Solo lectura` y el `Sidebar` (que **sí** filtra con `canAccessTab`) mostraba a todos el mismo set mínimo de módulos.

### Evidencia
- `Sidebar.tsx` ya filtra correctamente: `menuItems.filter(item => canAccessTab(userProfile.role, item.id))`. El bug **no** está en el Sidebar.
- `LoginForm.tsx` fallback: `const fallbackProfile = { ..., role: 'Solo lectura' }` cuando `profileError || !profile`.
- `authSession.ts` `restoreSessionProfileFromSupabase`: si la consulta falla, `rawRole = null` → `normalizeUserRole(null)` → `'Solo lectura'`.
- RLS: 0 políticas para anon/authenticated → la anon key no lee `users_profile`.

---

## 2. Vocabulario de roles (desajuste secundario)

- Backend `/api/auth/me` devuelve el rol como **AppRole** en minúsculas: `super admin`, `administrador`, `cobranza`, `tecnico`, `soporte`, `solo lectura`.
- Frontend `UserRole` usa **nombres de display**: `Super Admin`, `Administrador`, `Cobranza`, `Técnico`, `Soporte`, `Solo lectura`.
- Solución: normalizar con `normalizeUserRole()` al consumir `/api/auth/me`.

---

## 3. Solución aplicada (Fase 2.2)

1. **Backend**: `/api/auth/me` enriquecido para devolver `{ userId, email, fullName, phone, avatarUrl, role, permissions, source }` (usa la **service-role**, que sí lee `users_profile`).
2. **Frontend**: el perfil (incl. **rol**) se obtiene de **`/api/auth/me`**, no de la consulta directa bloqueada por RLS:
   - En login (`LoginForm`): tras `signInWithPassword`, se llama `/api/auth/me` con el `Bearer`.
   - En recarga (`App` bootstrap): se recupera la sesión de Supabase y se llama `/api/auth/me`.
3. **RBAC visual** (`rbac.ts` + `Sidebar`): `roleTabs` por rol (ver tabla en el resultado) y `getDefaultTabByRole` = **primer módulo permitido** (redirección segura).
4. **UI/UX de perfil**: chip de usuario + menú desplegable + modal de perfil (`UserMenu.tsx`), conservando el diseño actual.
5. **Estados UX**: validando sesión, cargando perfil, sin permiso, error de perfil, sesión expirada.

> No se modificó el esquema de Supabase. La RLS deny-by-default se mantiene (el acceso a datos va por el backend con service-role; el frontend NO lee tablas directamente para el rol).

---

## 4. Por qué NO se "abre" RLS para el frontend

Abrir políticas RLS para que la anon key lea `users_profile` sería una alternativa, pero:
- Aumenta la superficie de exposición de datos al cliente.
- El backend ya es la autoridad de identidad (Fase 2, JWT-only en prod).
- Mantener el rol canónico en `/api/auth/me` es consistente con "todo el acceso a datos pasa por el backend".

Por eso la corrección es **consumir `/api/auth/me`**, no relajar RLS.
