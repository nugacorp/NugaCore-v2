# Auth E2E Result — NugaCore staging

Fecha UTC: 2026-06-03T23:11:01Z
URL: https://nugacore-staging.5.180.151.109.sslip.io
Commit base validado antes de esta fase: `b1b1868e04e8152874dda061098ab1df328e230c`
Alcance: Auth staging únicamente.

## Resultado general

PASS.

Se validó Auth end-to-end en staging con Supabase Auth real, JWT real, refresh token, logout, RBAC y escritura protegida de Customers.

No se avanzó a Billing, MikroTik, Tickets ni Inventory como migración. Solo se usaron algunos endpoints existentes para validar RBAC por rol.

## Usuarios creados

| Rol | Email | Estado |
| --- | --- | --- |
| Super Admin | `superadmin@staging.nugacore.local` | creado/verificado |
| Administrador | `admin@staging.nugacore.local` | creado/verificado |
| Cobranza | `billing@staging.nugacore.local` | creado/verificado |
| Técnico | `tech@staging.nugacore.local` | creado/verificado |
| Soporte | `support@staging.nugacore.local` | creado/verificado |
| Solo lectura | `readonly@staging.nugacore.local` | creado/verificado |

Password temporal común:

- Guardado solo en `/root/nugacore-staging-secrets.env`.
- No impreso.
- No commiteado.

## Roles creados/asignados

Los roles ya existían en `public.roles`; se asignaron a los usuarios en `public.user_roles`:

- Super Admin
- Administrador
- Cobranza
- Técnico
- Soporte
- Solo lectura

## Login validado

PASS.

Validado con `supabase.auth.signInWithPassword` para los 6 usuarios staging.

Cada login emitió:

- access token JWT
- refresh token
- usuario Supabase Auth válido

## Logout validado

PASS.

Validado con `supabase.auth.signOut()`.

Resultado:

- sesión del cliente Supabase queda `null` después de logout.

## JWT validado

PASS.

Validado contra backend:

- `GET /api/auth/me` con `Authorization: Bearer ***`
- respuesta 200
- `source=supabase-jwt`
- rol resuelto desde DB correctamente para cada usuario

Roles observados:

- superadmin -> `super admin`
- administrador -> `administrador`
- cobranza -> `cobranza`
- tecnico -> `tecnico`
- soporte -> `soporte`
- readonly -> `solo lectura`

## Refresh validado

PASS.

Validado con:

- `supabase.auth.refreshSession({ refresh_token })`
- nuevo access token aceptado por `/api/auth/me`
- rol sigue resolviendo desde DB

Nota:

- No se esperó el TTL completo del JWT; se validó el mecanismo real de refresh.

## Sesión persistente / refresh de página

Parcialmente PASS.

Validado programáticamente:

- `src/lib/authSession.ts` usa `supabase.auth.getSession()` para restaurar sesión.
- `src/App.tsx` llama `restoreSessionProfileFromSupabase()` al boot.
- `src/App.tsx` obtiene token fresco con `supabase.auth.getSession()` antes de cada request.

No se ejecutó prueba browser automatizada de refresh visual de página porque el proyecto no tiene Playwright/Cypress instalado.

## RBAC validado

PASS.

| Rol | Validación | Resultado |
| --- | --- | --- |
| Super Admin | crear/leer/editar/suspender/reactivar/eliminar cliente | PASS |
| Administrador | crear/editar/eliminar Customers | PASS |
| Cobranza | leer facturación, editar/suspender/reactivar Customers | PASS |
| Cobranza | crear/eliminar Customers | bloqueado, PASS |
| Técnico | acceso endpoints de red existentes | PASS |
| Soporte | acceso endpoints de tickets existentes | PASS |
| Readonly | lectura Customers | PASS |
| Readonly | escritura Customers | bloqueado 403, PASS |

## Escritura protegida validada

PASS.

Con JWT válido:

1. Crear cliente ficticio: PASS.
2. Leer cliente: PASS.
3. Editar cliente: PASS.
4. Suspender cliente: PASS.
5. Reactivar cliente: PASS.
6. Eliminar cliente ficticio: PASS.
7. Confirmar limpieza: PASS.

Cliente ficticio usado:

- `Cliente Ficticio Auth E2E Remote`
- email ficticio: `cliente-auth-e2e-remote@staging.nugacore.local`

El cliente fue eliminado al final de la prueba.

## Seguridad validada

PASS.

- `AUTH_TRUST_HEADERS=false` confirmado por comportamiento efectivo.
- Spoofing de `x-user-role: super admin` sin Bearer fue bloqueado.
- Bearer inválido no autentica como `supabase-jwt`.
- Service-role key no aparece en frontend publicado.
- `MIKROTIK_CREDENTIALS_KEY` no aparece en frontend publicado.
- Password temporal staging no aparece en frontend publicado.
- Logs recientes del contenedor no contienen JWT/Bearer/secretos conocidos.

## Pruebas automatizadas

Comandos ejecutados:

```bash
npm run typecheck
```

Resultado: PASS.

```bash
npm test
```

Resultado: PASS.

- 34 passed
- 11 skipped cuando no se exportan secretos Supabase/Auth staging

Prueba Auth staging con secretos exportados:

```bash
npx vitest run tests/contract/auth.db.contract.test.ts
```

Resultado: PASS.

- 9 tests passed

Build:

```bash
npm run build
```

Resultado: PASS.

Notas:

- Vite mostró warning de chunk >500 kB; no bloquea build.
- npm audit mantiene vulnerabilidades conocidas de dependencias; no se corrigieron porque no era parte de Auth y se pidió no tocar otros frentes.

## Archivos generados/actualizados

- `docs/AUTH_AUDIT.md`
- `docs/STAGING_AUTH_USERS.md`
- `docs/AUTH_SECURITY_REPORT.md`
- `docs/AUTH_E2E_RESULT.md`
- `scripts/seed-staging-auth.mjs`
- `tests/contract/auth.db.contract.test.ts`

## Riesgos restantes

1. GET abiertos: varias lecturas siguen sin requerir JWT por contrato actual.
2. Falta UI de administración de usuarios/roles.
3. Password temporal común staging debe rotarse si estos usuarios quedan vivos.
4. Falta prueba browser automatizada de refresh visual de página.
5. No se validó MFA/2FA.
6. No se validó recuperación de contraseña con email recibido.

## Recomendación siguiente

Antes de migrar más módulos:

1. Decidir si se cierra auth obligatoria para lecturas GET sensibles.
2. Si se cierra, hacerlo en una fase dedicada Auth/API porque requiere coordinar frontend y backend.
3. Agregar Playwright/Cypress para validar login/logout/refresh visual en navegador.
4. Rotar o eliminar usuarios staging si dejan de usarse como fixtures.
