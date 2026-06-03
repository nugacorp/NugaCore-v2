# Auth Audit — NugaCore staging

Fecha UTC: 2026-06-03T23:11:01Z
Alcance: Auth staging únicamente. No se migró Billing, MikroTik, Inventory ni Tickets. No se tocó Coolify ni el diseño visual.

## Resumen

Staging usa Supabase Auth para login real, JWT de acceso y refresh token. El backend Express valida `Authorization: Bearer <jwt>` con `supabaseAdmin.auth.getUser()` y resuelve el rol desde `public.user_roles`/`public.roles`.

URL validada:

- https://nugacore-staging.5.180.151.109.sslip.io

## Supabase Auth actual

Funciona:

- Proyecto Supabase staging vigente: `https://elshnzkceutvjzxvzqad.supabase.co`.
- Usuarios ficticios staging creados en Supabase Auth.
- Email confirmado para usuarios staging.
- Login con `supabase.auth.signInWithPassword` probado para 6 roles.
- Supabase emite access token JWT y refresh token.
- Refresh token probado con `supabase.auth.refreshSession`.
- Logout probado con `supabase.auth.signOut`.

Falta / no cubierto:

- Flujo administrativo real para alta/baja/asignación de roles desde UI.
- Política formal de rotación de password temporal staging.
- MFA/2FA no validado.
- Recuperación de contraseña solo está implementada en UI, no fue validada end-to-end con recepción de email.

## Middleware JWT backend

Archivo principal:

- `backend/common/auth-context.ts`

Funciona:

- Extrae Bearer token desde `Authorization`.
- Valida el JWT con Supabase Admin.
- Si el JWT es válido, resuelve rol desde DB.
- Define `req.authContext = { userId, role, source: 'supabase-jwt' }`.
- En producción, `computeAllowTrustedHeaders(...)` siempre devuelve `false`; los headers `x-user-role` y `x-user-id` no pueden autenticar.
- Bearer inválido no produce `source=supabase-jwt`.

Riesgos / observaciones:

- Si Supabase Auth está caído, rutas protegidas devuelven 401 porque no se establece `authContext`.
- `/api/auth/me` no devuelve email; solo `userId`, `role`, `source`.
- Las lecturas GET de varios dominios siguen abiertas por contrato actual del frontend; la protección fuerte está aplicada sobre acciones de escritura o endpoints con `requireAction`.

## Roles y permisos

Roles canónicos backend:

- `super admin`
- `administrador`
- `cobranza`
- `tecnico`
- `soporte`
- `solo lectura`

Roles Supabase sembrados:

- `Super Admin`
- `Administrador`
- `Cobranza`
- `Técnico`
- `Soporte`
- `Solo lectura`

Funciona:

- Normalización de roles backend en `backend/common/rbac.ts`.
- Normalización de roles frontend en `src/lib/supabase.ts`.
- Cada usuario staging tiene perfil en `users_profile` y rol en `user_roles`.
- RBAC backend con `requireRoles` validado para Customers, Billing, Network y Tickets.
- Matriz `requireAction` existe para reports, automations y security.

Casos validados:

- Super Admin: Customers escritura total validada.
- Administrador: Customers crear/editar/eliminar validado.
- Cobranza: lectura facturación y edición/suspensión/reactivación de Customers validada; create/delete Customers bloqueado.
- Técnico: acceso red validado.
- Soporte: acceso tickets validado.
- Readonly: lectura Customers validada; escritura Customers bloqueada.

## Session handling / refresh tokens

Frontend:

- `src/components/LoginForm.tsx` usa `supabase.auth.signInWithPassword`.
- `src/App.tsx` usa `supabase.auth.signOut` en logout.
- `src/lib/authSession.ts` restaura sesión desde `supabase.auth.getSession`.
- `src/App.tsx` obtiene token fresco con `supabase.auth.getSession()` antes de cada request.

Validado:

- Login real.
- JWT emitido.
- Refresh token emitido.
- Refresh token renueva sesión.
- Logout limpia sesión del cliente Supabase.

No cubierto con navegador real:

- Persistencia visual tras refresh de página en browser. Se validó el mecanismo programático (`getSession`/refresh), no una prueba Playwright/Cypress porque el proyecto no tiene framework e2e browser instalado.

## Guards backend

Funciona:

- `requireRoles` devuelve 401 si no hay auth context.
- `requireRoles` devuelve 403 si el rol no está permitido.
- `requireAction` aplica matriz de permisos por acción.
- Spoofing de `x-user-role: super admin` sin Bearer no permite crear Customers en staging.

Riesgos / casos no cubiertos:

- Muchos GET siguen abiertos para compatibilidad del frontend actual.
- Para cerrar completamente lectura sensible habría que cambiar contrato de frontend/API en otra fase.

## Guards frontend

Funciona:

- `src/lib/rbac.ts` limita tabs visibles por rol.
- `getDefaultTabByRole` envía Cobranza a billing, Técnico/Soporte a support y demás a dashboard.
- `App.tsx` corrige `activeTab` si el rol no puede acceder al tab.

Riesgo:

- Los guards frontend son cosméticos; la seguridad real debe permanecer en backend.

## Riesgos principales

1. GET abiertos: varias lecturas sensibles siguen sin exigir JWT por diseño actual.
2. Provisioning de usuarios: todavía es script/manual, no UI administrativa.
3. Password temporal común: útil para staging, no aceptable para producción.
4. Service-role key: debe seguir solo backend/Coolify; no debe llegar al frontend.
5. Logs: se validó que no haya JWT/secretos en logs recientes, pero se debe mantener disciplina de no loggear headers.

## Casos no cubiertos

- MFA/2FA.
- Recovery email end-to-end.
- Expiración real esperando TTL completo del JWT; se validó refresh, no espera de expiración por tiempo real.
- Prueba browser automatizada de refresh de página.
- Administración productiva de usuarios/roles.
