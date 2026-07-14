# Staging Auth Users

Fecha UTC: 2026-06-03T23:11:01Z
Alcance: usuarios ficticios para validar Auth/RBAC en staging.

## Estado

Usuarios creados en Supabase Auth staging y vinculados a:

- `public.users_profile`
- `public.user_roles`
- `public.roles`

Password temporal común:

- Configurado localmente en `/root/nugacore-staging-secrets.env` como `STAGING_AUTH_PASSWORD`.
- No se imprime en logs.
- No se commitea.
- No se documenta en claro.

## Usuarios creados

| Rol | Email staging | Perfil | Estado |
| --- | --- | --- | --- |
| Super Admin | `superadmin@staging.nugacore.local` | Staging Super Admin | creado/verificado |
| Administrador | `admin@staging.nugacore.local` | Staging Administrador | creado/verificado |
| Cobranza | `billing@staging.nugacore.local` | Staging Cobranza | creado/verificado |
| Técnico | `tech@staging.nugacore.local` | Staging Técnico | creado/verificado |
| Soporte | `support@staging.nugacore.local` | Staging Soporte | creado/verificado |
| Solo lectura | `readonly@staging.nugacore.local` | Staging Solo Lectura | creado/verificado |

## Procedimiento usado

Script idempotente:

```bash
set -a
. /root/nugacore-staging-secrets.env
set +a
export SUPABASE_URL='https://elshnzkceutvjzxvzqad.supabase.co'
node scripts/seed-staging-auth.mjs
```

El script:

1. Usa `SUPABASE_SERVICE_ROLE_KEY` desde archivo local root-only.
2. Usa `STAGING_AUTH_PASSWORD` desde archivo local root-only.
3. Crea usuarios en Supabase Auth con `email_confirm=true`.
4. Crea/actualiza `users_profile`.
5. Inserta relación en `user_roles`.
6. No imprime password ni tokens.

## Resultado de ejecución

Resultado: PASS.

Usuarios creados/existentes y roles vinculados correctamente:

- `superadmin@staging.nugacore.local` -> `Super Admin`
- `admin@staging.nugacore.local` -> `Administrador`
- `billing@staging.nugacore.local` -> `Cobranza`
- `tech@staging.nugacore.local` -> `Técnico`
- `support@staging.nugacore.local` -> `Soporte`
- `readonly@staging.nugacore.local` -> `Solo lectura`

## Rotación recomendada

Después de cerrar la validación, mantener estos usuarios solo como fixtures staging o rotar el password común.

Para rotar:

1. Cambiar `STAGING_AUTH_PASSWORD` en `/root/nugacore-staging-secrets.env`.
2. Actualizar los passwords en Supabase Auth para los 6 usuarios.
3. Re-ejecutar las pruebas Auth E2E.

No usar este patrón de password común en producción.
