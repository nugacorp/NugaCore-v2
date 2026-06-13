# Portal Pagos — Validación UI en Staging

## Pre-requisitos

| Variable | Valor esperado |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto staging (misma que `SUPABASE_URL` del backend) |
| `VITE_SUPABASE_ANON_KEY` | Anon key del proyecto staging |
| `USE_DB_CUSTOMERS` | `true` en staging |
| `USE_DB_BILLING` | `true` en staging |

> Verificar que el frontend apunta al mismo proyecto Supabase que el backend.
> Si difieren, el login JWT será aceptado por el backend pero las queries de cliente/factura fallarán.

---

## Login en staging

1. Navegar a la URL del frontend de staging.
2. Ingresar credenciales de un usuario de prueba con rol `Cobranza` o `Administrador`.
3. Verificar que el token JWT se almacena en `localStorage` bajo la clave de sesión de Supabase.
4. Abrir DevTools → Network → confirmar que `/api/payments/orders` se llama con `Authorization: Bearer <token>`.

### Roles requeridos para Portal Pagos

| Acción | Roles permitidos |
|---|---|
| Ver órdenes y acciones | Solo lectura, Cobranza, Administrador, Super Admin |
| Crear payment_order | Cobranza, Administrador, Super Admin |
| Reactivar cliente | Cobranza, Administrador, Super Admin |

---

## Test de flujo completo (Golden Path)

1. **Login** como `Cobranza`.
2. Navegar a **Portal Pagos & Reactivación** en el sidebar.
3. **Crear orden de pago:**
   - Ingresar `customerId` de un cliente existente en la DB de staging.
   - Ingresar `invoiceId` de una factura que pertenezca a ese cliente.
   - Seleccionar provider `manual`.
   - Ingresar `amount` en pesos (ej. `299`).
   - Confirmar que la respuesta devuelve `status: "pending"`.
4. **Verificar lista de órdenes:** La nueva orden debe aparecer en la lista.
5. **Reactivar cliente (dry run):**
   - Ingresar `customerId` de un cliente con `status: "suspended"`.
   - Confirmar respuesta `alreadyActive: false`, `dryRun: true` en la acción MikroTik.
   - Verificar que la acción aparece en la lista de Acciones MikroTik con badge `DRY RUN`.

---

## Casos de error a validar

| Scenario | HTTP esperado | Código |
|---|---|---|
| Factura de otro cliente | 400 | `INVOICE_CLIENT_MISMATCH` |
| `amount` y `amountCents` contradictorios | 400 | `AMOUNT_MISMATCH` |
| Cliente inexistente | 404 | `NOT_FOUND` |
| Factura inexistente | 400 | `BAD_REQUEST` |
| Sin permisos de escritura (Solo lectura) | 403 | `FORBIDDEN` |
| Sin sesión / token expirado | 401 | `UNAUTHORIZED` |

---

## Limpieza de sesión

Antes de re-testear con otro rol:
1. `localStorage.clear()` en la consola del browser, o
2. DevTools → Application → Storage → Clear site data.

Luego recargar y hacer login con el nuevo usuario.

---

## Verificación de JWT

```bash
# Obtener token desde staging (reemplazar credenciales)
curl -X POST https://<SUPABASE_URL>/auth/v1/token?grant_type=password \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret"}'

# Probar endpoint con el token
curl https://<BACKEND_URL>/api/payments/orders \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

El backend valida el JWT contra Supabase Auth. Si devuelve 401, el token está expirado o el proyecto Supabase no coincide.
