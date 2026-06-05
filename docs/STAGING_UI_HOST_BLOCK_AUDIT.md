# STAGING UI HOST BLOCK — AUDITORÍA (Fase 4.5.2 · Tarea 1)

Fecha: 2026-06-05
Síntoma en staging:
- `Blocked request. This host is not allowed. To allow this host, add ... to server.allowedHosts in vite.config.js`.
- Errores de permisos sobre `/app/node_modules/.vite`.

## 1. Por qué staging intenta usar Vite allowedHosts

`server.ts` elegía el modo de servido así:

```ts
if (!isProduction) {  // isProduction = NODE_ENV === 'production'
  // ...crea el VITE DEV SERVER y lo monta como middleware
} else {
  // ...sirve dist/ estático
}
```

`env.ts` define `NODE_ENV = process.env.NODE_ENV || 'development'`. Si el
contenedor de staging **no** define `NODE_ENV=production` (Coolify no lo pasa,
o arranca con `npm run dev:tsx`/buildpack), `isProduction` es `false` y el
servidor monta el **Vite dev server**. Vite, por seguridad, **bloquea hosts
no declarados** → de ahí el "This host is not allowed".

## 2. ¿Se está sirviendo con Vite dev server por accidente?

Sí. El dev server es solo para desarrollo (HMR, transform on-the-fly). En
staging debe servirse el **build estático** (`dist/`). El bloqueo de host y
el intento de escribir caché confirman que staging cayó en la rama de dev.

## 3. Por qué aparece `/app/node_modules/.vite`

Es el **directorio de caché de Vite** (optimize deps). El Vite dev server
intenta escribirlo. La imagen corre como `USER node` (no-root) y
`node_modules` es propiedad de root → `EACCES`. Otra señal de que el dev
server no debería estar corriendo ahí.

## 4. Cómo se corrige de forma segura

1. **Decidir el modo por la presencia del build**, no solo por `NODE_ENV`:
   - `SERVE_MODE=static|dev` fuerza el modo (override explícito).
   - `isProduction` → `static`.
   - si existe `dist/index.html` (imagen ya construida) → `static`.
   - solo sin build y en desarrollo → Vite dev.
   La imagen de staging/producción se construye con `npm run build` (Dockerfile),
   así que `dist/index.html` existe → **sirve estático** aunque `NODE_ENV` no sea
   exactamente `production`. Esto elimina el host-block y el `.vite` EACCES.
2. **`allowedHosts` explícito** (sin wildcard) vía `VITE_ALLOWED_HOSTS` (lista
   separada por comas), por si en algún entorno se usa el dev server detrás de
   un host concreto. Nunca `allowedHosts: true`.
3. Express ya sirve `dist/` con cache busting correcto (Fase 4.3.1): `index.html`
   `no-cache`, `/assets/*` inmutable.

**No rompe dev local**: `dev:tsx` (sin build) sigue usando el Vite dev server.

## 5. Recomendación de despliegue (Hermes)

- Preferido: definir `NODE_ENV=production` (o `SERVE_MODE=static`) en el servicio de staging.
- Con el fix, aunque no se defina, mientras la imagen tenga `dist/` construido, se sirve estático.
- Si por algún motivo se usa el dev server, definir `VITE_ALLOWED_HOSTS=<host-staging>`.
