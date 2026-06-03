# Auth Security Report — NugaCore staging

Fecha UTC: 2026-06-03T23:11:01Z
URL: https://nugacore-staging.5.180.151.109.sslip.io
Alcance: seguridad Auth staging únicamente.

## Resultado general

PASS con riesgos residuales documentados.

## Configuración validada

- `AUTH_TRUST_HEADERS=false` en staging.
- Backend en producción ignora trusted headers aunque alguien intente enviar `x-user-role`/`x-user-id`.
- Identidad backend para rutas protegidas viene de JWT Supabase verificado.
- Roles vienen de `public.user_roles`, no de headers del cliente.

## No bypass auth

Prueba ejecutada:

- `POST /api/clients` sin Bearer, con headers spoofed:
  - `x-user-role: super admin`
  - `x-user-id: spoofed`

Resultado:

- Bloqueado con 401/403.
- No creó cliente.
- No produjo `source=supabase-jwt`.

Conclusión:

- No hay bypass por trusted headers en staging.

## Endpoints abiertos por error

Observación:

- Escrituras protegidas de Customers, Tickets, Network, Billing y otros dominios usan `requireRoles`/`requireAction`.
- Lecturas GET de varios dominios siguen abiertas por contrato actual del frontend.

No se considera “por error” para esta fase porque el contrato actual mantiene lecturas abiertas para compatibilidad. Sí queda como riesgo de seguridad para cerrar en una fase posterior.

Endpoints de escritura validados:

- `/api/clients` POST/PUT/DELETE protegidos.
- `/api/network-towers` POST protegido.
- `/api/tickets` POST protegido.
- `/api/billing/invoices` lectura validada para cobranza; acciones de pago/facturación están protegidas por rol en código.

## Service role key expuesta

Validación:

- Se descargó HTML/JS/CSS publicado del frontend staging.
- Se buscó presencia de:
  - valor completo de `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `service_role`
  - valor completo de `MIKROTIK_CREDENTIALS_KEY`
  - `STAGING_AUTH_PASSWORD`

Resultado:

- PASS: no se encontró service-role key ni secretos backend en frontend.

Nota:

- La anon key de Supabase sí está embebida como `VITE_SUPABASE_ANON_KEY`; eso es esperado para Supabase frontend y no es equivalente a service-role.

## JWT / secretos en logs

Validación:

- Se revisaron logs recientes del contenedor de la app.
- Se buscó presencia de Bearer/JWT/secretos conocidos.

Resultado:

- PASS: no se encontraron JWT, Bearer tokens ni secretos en logs recientes.

## Logout / refresh / sesión

Validado:

- Login emite access token y refresh token.
- Refresh renueva sesión y el nuevo access token autentica contra backend.
- Logout con Supabase limpia la sesión del cliente.

Riesgo residual:

- No se midió expiración real esperando el TTL completo del JWT; se validó refresh token, que es el mecanismo operativo necesario para sesiones largas.

## RBAC seguridad

Validado:

- Readonly no puede escribir Customers.
- Cobranza puede editar/suspender/reactivar Customers pero no crear/eliminar Customers.
- Superadmin y administrador pueden operar Customers.
- Técnico accede a red.
- Soporte accede a tickets.

## Riesgos restantes

1. Lecturas GET sensibles abiertas: cerrar después requiere cambiar contrato frontend/API.
2. Password temporal común staging: rotarlo o eliminar usuarios tras la validación si no se usarán como fixtures.
3. Falta UI de administración de usuarios/roles.
4. Falta browser e2e automatizado para refresh visual de página.
5. Mantener vigilancia sobre logs para no imprimir headers Authorization en futuras rutas.

## Recomendación

Antes de migrar más módulos:

1. Decidir si las lecturas GET deben exigir JWT en staging/prod.
2. Si sí, planificar una fase dedicada para cambiar frontend/API sin romper la UX.
3. Agregar Playwright/Cypress si se quiere validar persistencia visual de sesión tras refresh de página.
