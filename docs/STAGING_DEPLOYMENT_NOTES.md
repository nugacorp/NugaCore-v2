# Staging deployment notes

Fecha de actualización: 2026-06-04

URL de staging: https://nugacore-staging.5.180.151.109.sslip.io

Commit validado al actualizar este documento: `f8f0efe test: make local test suite hermetic`

## Objetivo

Este documento resume el estado operativo de staging y las decisiones de despliegue que sí conviene versionar en el repositorio.

No incluye secretos, tokens, JWT, passwords, UUIDs internos de Coolify, hostnames privados, ni identificadores de deployments.

## Estado actual

- Staging está desplegado desde la rama `main`.
- Auto-deploy está habilitado para `main`.
- La aplicación se construye con Dockerfile.
- El servicio expone internamente el puerto de aplicación configurado por `PORT`.
- HTTPS se sirve mediante el proxy administrado por Coolify/Traefik.
- El frontend activo al momento de esta actualización sirve el asset `/assets/index-D6GYOEvF.js`.

## Health checks esperados

Estos endpoints deben responder correctamente en staging:

- `/api/health/live` -> `200`, cuerpo con `status: ok`.
- `/api/health/ready` -> `200`, cuerpo con `status: ready`.

La validación más reciente confirmó ambos endpoints como PASS.

## Configuración de entorno esperada

Runtime:

- `NODE_ENV=production`
- `PORT` configurado para el proceso Node
- `AUTH_TRUST_HEADERS=false`
- `USE_DB_CUSTOMERS=true`
- `SUPABASE_URL` configurado
- `SUPABASE_SERVICE_ROLE_KEY` configurado solo como variable runtime
- `MIKROTIK_CREDENTIALS_KEY` configurado solo como variable runtime
- `LOG_LEVEL=info`
- `LOG_FORMAT=json`

Build-time/frontend:

- `VITE_SUPABASE_URL` configurado
- `VITE_SUPABASE_ANON_KEY` configurado para build de Vite

Notas de seguridad:

- No usar variables sensibles de backend como build-time args.
- Las claves service-role y llaves de cifrado deben permanecer runtime-only.
- El anon key de Supabase puede ser requerido por el frontend, pero no deben registrarse valores completos en documentación ni logs compartidos.

## Healthcheck de contenedor

La imagen final de la aplicación no debe depender de `curl` o `wget` para su healthcheck interno.

Criterio recomendado:

- Usar healthcheck implementado con Node/fetch o mecanismo equivalente disponible en la imagen final.
- Validar externamente con `/api/health/live` y `/api/health/ready` después de cada deploy.

Motivo:

- Algunas imágenes slim/alpine no incluyen `curl` ni `wget`.
- Si Coolify fuerza un HTTP healthcheck que asume esas herramientas, puede marcar como unhealthy una app que sí responde correctamente.

## Proxy y HTTP/3

En staging se deshabilitó HTTP/3/QUIC en el proxy para evitar errores de carga de assets en navegadores que intentaban usar QUIC.

Estado esperado:

- No exponer UDP 443 para esta ruta/proxy.
- No anunciar `alt-svc: h3` en respuestas del HTML ni assets.
- Mantener HTTP/1.1 y HTTP/2 funcionando correctamente sobre HTTPS.

Validación esperada:

- `/` responde 200.
- Asset principal responde 200.
- Headers no anuncian `h3`.
- Health checks siguen en PASS.

## Auth y RBAC staging

Estado validado:

- Login real con usuarios staging: PASS.
- Perfil visible con email y rol: PASS.
- Menú/modal de perfil: PASS.
- Badge/chip de rol: PASS.
- Logout: PASS.
- Refresh conserva sesión/rol/módulos: PASS.
- Endpoints protegidos sin auth header siguen fallando cerrado con 401: PASS.

Detalle completo:

- Ver `docs/FRONTEND_RBAC_PROFILE_STAGING_RESULT.md`.

## Pruebas recomendadas después de cambios en staging

Ejecutar, como mínimo:

```bash
npm run typecheck
npm run build
npm test
```

Para contratos de auth/RBAC contra staging, usar el flujo documentado por los tests actuales y variables de entorno locales seguras. No imprimir tokens ni credenciales en salida compartida.

## Checklist post-deploy

1. Confirmar commit desplegado desde `main`.
2. Confirmar `/api/health/live`.
3. Confirmar `/api/health/ready`.
4. Confirmar que `/` carga con HTTP 200.
5. Confirmar que el asset principal carga con HTTP 200.
6. Confirmar que no reaparece `alt-svc: h3`.
7. Confirmar login y `/api/auth/me` con usuario staging.
8. Confirmar que sin auth header los endpoints protegidos devuelven 401.
9. Confirmar logout y refresh de sesión.
10. Revisar logs sin exponer secretos.

## Qué no contiene este documento

Este documento omite deliberadamente:

- Passwords.
- JWTs.
- Tokens de API.
- Llaves service-role.
- UUIDs internos de Coolify.
- UUIDs de deployments.
- Hostnames privados del servidor.
- Valores completos de variables sensibles.

## Recomendación operativa

Mantener este archivo como guía versionada de staging.

Las bitácoras detalladas de operación, con IDs internos o información de infraestructura, deben quedarse fuera del repo en notas locales/seguras de operaciones.
