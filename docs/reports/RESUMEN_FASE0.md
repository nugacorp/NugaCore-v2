# Parte de entrega — Fase 0 + hardening seguro

**Fecha:** 2026-07-08
**Alcance autorizado:** Fase 0 del `PLAN_CORRECCION_2026-07-08.md` (+ hardening seguro de Fase 1).
**Regla:** cambios mínimos, sin romper contratos de API, con tests, y validación completa.

## Resultado de validación (comandos reales)
- `npm run typecheck` → PASS
- `npx eslint .` → PASS (0 errores; 104 warnings preexistentes)
- `npm test` → PASS — 1838 passed / 49 skipped (base 1827 + 11 casos nuevos)
- `npm run build` → PASS

## Cambios aplicados

### C-01 · Webhook de pago manual (Crítico)
- `manual.provider.ts`: exige firma HMAC-SHA256 cuando hay `WEBHOOK_SECRET_MANUAL`; sin secreto conserva comportamiento legacy (solo fuera de runtime endurecido).
- `payments/routes.ts`: fail-closed — en runtime endurecido, webhook sin secreto → `503 WEBHOOK_NOT_CONFIGURED`.
- Hardening extra: guard de longitud en `mercadopago`/`openpay` verifyWebhook (firma malformada → 400 limpio, ya no 500).

### C-03 · Endurecimiento de entorno (Crítico)
- `config/env.ts`: `PUBLIC_DEPLOYMENT` + `isHardenedRuntime = isProduction || isPublicDeployment`; fail-fast bajo runtime endurecido.
- `auth-context.ts`: trusted-headers (`x-user-role`) SIEMPRE off en runtime endurecido.
- `http-security.ts`: HSTS/CSP/trust-proxy activos en runtime endurecido (no solo `NODE_ENV==='production'`).

### C-02 · RBAC en GIS (Alto/Crítico)
- `gis/routes.ts`: `requireRoles(READ_ROLES)` en `layers`, `map-data`, `customers`, `towers`. `health` sigue público.

### H-01 · xlsx (Alto) — sin cambio de código
- Verificado: `xlsx` solo EXPORTA (`json_to_sheet`+`write`), no parsea input de usuario → prototype-pollution/ReDoS no alcanzables. No se migra de librería (evita refactor innecesario). Fijar versión y revisar en cada `npm audit`.

## Archivos
Modificados: `backend/config/env.ts`, `backend/common/auth-context.ts`, `backend/common/http-security.ts`, `backend/domains/gis/routes.ts`, `backend/domains/payments/providers/manual.provider.ts`, `backend/domains/payments/providers/mercadopago.provider.ts`, `backend/domains/payments/providers/openpay.provider.ts`, `backend/domains/payments/routes.ts`, `.env.example`, `.env.production.example`.
Nuevos tests: `tests/unit/payments.manual-webhook.test.ts`, `tests/unit/payments.provider-signature.test.ts`, `tests/contract/gis.rbac.test.ts`, `tests/contract/payments.webhook-hardening.test.ts`.

## Pendientes (necesitan tu entorno/decisión)
1. **C-04** rotar secretos (service-role, DB password, staging password) → gestor de secretos de Coolify.
2. **Config servidor:** `PUBLIC_DEPLOYMENT=true`, `AUTH_TRUST_HEADERS=false`, `WEBHOOK_SECRET_MANUAL`.
3. **manifest.json ERR_SSL_PROTOCOL_ERROR:** capa TLS/reverse-proxy (N-02), no app.
4. **Opcionales con checkpoint:** validación por schema ampliada (Commit 5), token en cookie HttpOnly (Commit 7).

## Verificación en vivo
Tras configurar `PUBLIC_DEPLOYMENT=true` y `WEBHOOK_SECRET_MANUAL` en staging, ejecutar:
`bash scripts/smoke-staging.sh https://nugacore-staging.5.180.151.109.sslip.io`
