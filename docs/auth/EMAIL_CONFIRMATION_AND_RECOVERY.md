# Confirmación de email y recuperación de contraseña

## Comportamiento en NugaCore

| Flujo | Qué hace la app |
|---|---|
| Registro WISP | Crea el usuario con `email_confirm: false`, persiste tenant/onboarding y **después** dispara el correo Signup (`auth.resend`). Así no llega un enlace si el alta falló. El operador **no** entra hasta confirmar. |
| Login sin confirmar | Mensaje claro + botón **Reenviar confirmación**. |
| Olvidé mi contraseña | `resetPasswordForEmail` → enlace a `/reset-password` → `updateUser({ password })`. |

## Checklist Supabase (Dashboard)

En el proyecto Auth (staging/prod):

1. **Authentication → Providers → Email**  
   - Enable Email provider: ON  
   - **Confirm email: ON**
2. **Authentication → URL configuration**  
   - Site URL = URL pública de la app (staging/prod)  
   - Redirect URLs (mínimo):  
     - `https://<app>/auth/callback`  
     - `https://<app>/reset-password`  
     - `http://localhost:3000/auth/callback` (dev)  
     - `http://localhost:3000/reset-password` (dev)
3. **Authentication → Emails**  
   - Plantillas Confirm signup y Reset password activas  
   - SMTP propio o el de Supabase (límites del plan)
4. **Authentication → Attack Protection** (o Password security)  
   - **Leaked password protection: ON** (HaveIBeenPwned). Es un toggle de Auth,
     no una migración SQL; el advisor `auth_leaked_password_protection` se
     apaga solo cuando lo activas en el Dashboard.

## Variables de entorno

| Variable | Rol |
|---|---|
| `APP_URL` | Origen permitido para `emailRedirectTo` / redirects del backend |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Alta de usuario (admin) |
| `SUPABASE_ANON_KEY` (o `VITE_SUPABASE_ANON_KEY` en build) | `resend` del correo de confirmación desde el backend |
| `VITE_SUPABASE_*` | Cliente: login, reset, resend en UI |

Sin `SUPABASE_ANON_KEY` en runtime, el alta igual crea el usuario sin confirmar, pero el correo puede no enviarse; el login ofrece reenviar.
