# NugaCore — Validación RBAC visual + Perfil (Fase 2.2)

> Fecha: 2026-06-03 · Conecta el perfil real (`/api/auth/me`) al frontend y aplica RBAC visual por rol.
> Para validación en **staging** por Hermes con los 6 usuarios sembrados.

---

## 1. Causa raíz (resuelta)
El frontend resolvía el rol consultando Supabase directo (anon key), pero **RLS deny-by-default** lo bloqueaba → todos caían a `Solo lectura` → todos veían lo mismo. Ahora el rol/perfil sale de **`/api/auth/me`** (backend, service-role). Detalle: [FRONTEND_AUTH_RBAC_AUDIT.md](FRONTEND_AUTH_RBAC_AUDIT.md).

## 2. Flujo nuevo
```
login (LoginForm: supabase.auth.signInWithPassword) → access_token
   → GET /api/auth/me (Bearer) → { role, email, fullName, permissions, source }
   → estado global (App) → Sidebar filtra módulos por rol → perfil visible (UserMenu)
recarga: App bootstrap → supabase.getSession() → /api/auth/me → reconstruye perfil → RBAC
sin sesión → limpia cache → login
```

## 3. Tabla de módulos por rol (RBAC visual)

| Rol | Módulos visibles |
|-----|------------------|
| **Super Admin** | dashboard, crm, billing, finance, network, mikrotik, support, inventory, gis, owner (todos) |
| **Administrador** | dashboard, crm, billing, network, support, inventory, gis |
| **Cobranza** | dashboard, crm, billing, finance |
| **Técnico** | dashboard, network, mikrotik, support, inventory, gis |
| **Soporte** | dashboard, crm, support, gis |
| **Solo lectura** | dashboard, crm, billing, network, gis |

> Notas: las distinciones "lectura" se aplican por RBAC del backend en escrituras (el módulo es visible para consulta). "Settings" del brief no existe como módulo aún (omitido). Acceso manual a un tab no permitido → redirige al primer módulo permitido (dashboard) + aviso "No tienes permiso para este módulo".

## 4. UI/UX de perfil
- **Barra superior** (escritorio y móvil): chip con avatar/iniciales + nombre + badge de rol + menú desplegable.
- **Menú**: Ver perfil · Mi sesión · Cerrar sesión.
- **Modal de perfil**: email, rol, user id, origen de auth (`supabase-jwt`), módulos visibles, permisos.
- El sidebar conserva su tarjeta de operador + botón "Salir del Sistema".
- Diseño/estilo sin cambios (mismo lenguaje slate/indigo).

## 5. Logout
`supabase.auth.signOut()` + limpia perfil y access token de `localStorage` + `userSession=null` → render Login. Recarga sin sesión válida → login (no se muestra dashboard con sesión obsoleta).

## 6. Verificación local (esta entrega)
- `npm run typecheck` ✅
- `npm test` (CI/mock) ✅ **43 passed, 6 skipped** (incluye 9 nuevas de RBAC frontend; DB/auth se omiten sin Supabase)
- `npm run build` ✅
- `/api/auth/me` enriquecida validada en vivo contra Supabase: `role`, `email`, `fullName`, `permissions`, `source=supabase-jwt`.
- Nota: la prueba de integración `auth.db.contract.test.ts` es sensible al **rate-limit** de Supabase Auth si se corre muchas veces seguidas (en CI se omite; correcta cuando el límite está frío).

---

## 7. Qué debe validar Hermes en staging (con los 6 usuarios)

Password: el de `STAGING_AUTH_PASSWORD` (lo tiene el dueño). Usuarios: `*@nugacore.local`.

Para cada usuario, marcar:

- [ ] **superadmin@** — ve **todos** los módulos (incl. MikroTik, Owner, Finanzas).
- [ ] **admin@** — ve administración; **NO** ve MikroTik, **NO** Finanzas, **NO** Owner.
- [ ] **cobranza@** — ve Billing y Finanzas; **NO** ve MikroTik ni Red.
- [ ] **tecnico@** — ve Red, MikroTik, Soporte, Inventario, GIS; **NO** Finanzas ni Billing.
- [ ] **soporte@** — ve CRM, Soporte, GIS; **NO** Billing, **NO** MikroTik.
- [ ] **lectura@** — ve Dashboard/CRM/Billing/Red/GIS (lectura); **NO** MikroTik/Soporte/Inventario/Owner.
- [ ] Cada usuario muestra **su perfil correcto** (chip + modal: email, rol, permisos).
- [ ] **Logout** funciona y al recargar pide login.
- [ ] Acceso manual a un tab no permitido redirige + muestra aviso.

> Recordatorio: en staging `NODE_ENV=production` ⇒ identidad por **JWT** (trusted-headers ignorados). Las lecturas abiertas cargan sin login; las escrituras requieren rol adecuado.

## 8. Resultado (rellenar)
- Fecha: `____` · Commit: `____` · URL: `____`
- Resultados por rol: `____`
- Incidencias: `____`
- Estado final: [ ] OK [ ] con observaciones [ ] fallido
