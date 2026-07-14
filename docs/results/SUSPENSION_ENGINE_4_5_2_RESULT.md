# SUSPENSION ENGINE 4.5.2 — RESULTADO

Fecha: 2026-06-05
Objetivo: cerrar los **2 bloqueos** que mantenían la Fase 4.5 sin aprobar
(la lógica ya pasó: dashboard, Escenario A/B, trazabilidad, RBAC, no-ejecución).
Sin Worker, sin acciones reales, sin cambiar lógica de negocio validada.

Auditorías: [STAGING_UI_HOST_BLOCK_AUDIT.md](../audits/STAGING_UI_HOST_BLOCK_AUDIT.md) · [SUSPENSION_TEST_TOOLS_CLEANUP_AUDIT.md](../audits/SUSPENSION_TEST_TOOLS_CLEANUP_AUDIT.md).

## 1. Causa raíz — UI de staging

`server.ts` montaba el **Vite dev server** siempre que `NODE_ENV !== 'production'`.
Como `NODE_ENV` por defecto es `development`, staging caía en la rama de dev →
Vite **bloqueaba el host** ("This host is not allowed") e intentaba escribir
`/app/node_modules/.vite` (EACCES como usuario no-root).

## 2. Causa raíz — cleanup Escenario B

El `DELETE` solo borraba el cliente. La factura **pagada** dejó `payments` y
`payment_applications` con FK **ON DELETE RESTRICT** → `DELETE FROM clients`
fallaba con **500**.

## 3. Cambios aplicados

**UI:**
- `server.ts`: `resolveServeMode()` decide por build presente / `SERVE_MODE` / `isProduction`. Con `dist/index.html` (imagen construida) sirve **estático** aunque `NODE_ENV` no sea `production`. El Vite dev server solo corre en modo `dev`.
- `allowedHosts` explícito desde `VITE_ALLOWED_HOSTS` (server.ts y vite.config.ts). **Nunca** wildcard.

**Cleanup:**
- `DELETE /api/suspension/test-tools/customer/:id` ahora purga en orden de FK: `payment_applications → payments → invoice_items → invoices → suspension_orders/reactivation_orders/suspension_events/customer_service_state → clients`.
- DB mode vía `supabaseAdmin`; mock vía store. Idempotente.
- Candado: solo clientes `__TEST__`; clientes reales → 403; inexistente → `{removed:false, reason:'not_found'}`.
- `SuspensionRepository.purgeCustomer` (Store + Supabase) + `engineStore.purgeCustomer`.

## 4. Archivos modificados / creados

**Modificados:** `server.ts`, `vite.config.ts`, `backend/domains/suspension/{routes,repository,engine-store}.ts`, `tests/contract/suspension.db.contract.test.ts`.
**Creados:** `tests/contract/suspension.cleanup.contract.test.ts`, `tests/unit/staging.serve-mode.test.ts`, `docs/STAGING_UI_HOST_BLOCK_AUDIT.md`, `docs/SUSPENSION_TEST_TOOLS_CLEANUP_AUDIT.md`, `docs/SUSPENSION_ENGINE_4_5_2_RESULT.md`.

## 5. Cómo validar en staging

**UI:**
1. Asegurar que el servicio de staging corre la imagen construida (Dockerfile). Recomendado: `NODE_ENV=production` o `SERVE_MODE=static`.
2. Abrir la URL de staging → carga el HTML del build, los `assets/*`, el login y el módulo **Suspensiones**.
3. Ya no aparece "This host is not allowed" ni errores `/app/node_modules/.vite`.
4. (Opcional) Si se usara el dev server, `VITE_ALLOWED_HOSTS=<host>`.

**Cleanup:**
```
POST   /api/suspension/test-tools/scenario { confirm:true, scenario:"B" }
POST   /api/suspension/evaluate/<id>
DELETE /api/suspension/test-tools/customer/<id>   → 200 { removed:true } (sin 500, sin SQL manual)
DELETE /api/suspension/test-tools/customer/<id>   → 200 { removed:false, reason:"not_found" } (idempotente)
DELETE /api/suspension/test-tools/customer/<id-real> → 403 (rechaza clientes reales)
```

## 6. Resultado de validación local

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ sin errores |
| `npm test` | ✅ 267 passed / 34 skipped |
| `npm run build` | ✅ OK |
| `RUN_DB_TESTS=true npm run test:db` | ⏭️ requiere credenciales staging (entorno de Hermes). El `afterAll` usa el endpoint DELETE (autosuficiente). |

## 7. Riesgos restantes

- Si Coolify arranca con `npm run dev:tsx` (sin build), volvería a modo dev; mitigación: el default sirve estático cuando hay build, y existe `SERVE_MODE=static` y `VITE_ALLOWED_HOSTS`.
- El cleanup cubre las tablas que crean los escenarios; entidades no creadas por test-tools (credit_notes/adjustments) no se tocan.
- `SupabaseSuspensionRepository.purgeCustomer` se ejercita bajo `RUN_DB_TESTS`; validar en staging.
- Sin cambios en la lógica de negocio ya aprobada; nada se ejecuta (órdenes siguen `PENDING`).

## 8. Instrucciones para Hermes

1. **UI**: desplegar staging con la imagen construida (idealmente `NODE_ENV=production` o `SERVE_MODE=static`); abrir la URL → HTML/assets/login/Suspensiones cargan; sin host-block ni `.vite` EACCES.
2. **Cleanup B**: crear Escenario B, evaluar, `DELETE` del cliente → **200** (antes 500), sin limpieza manual.
3. **Idempotencia**: repetir el `DELETE` → `{removed:false, reason:"not_found"}`.
4. **Seguridad**: `DELETE` sobre un cliente real → **403**; herramienta no disponible en producción.
5. **Regresión**: la lógica 4.5/4.5.1 sigue intacta (dashboard `delinquent`, Escenarios A/B, RBAC, no-ejecución).
6. (Opcional) `RUN_DB_TESTS=true npm run test:db`.

No se avanza a Fase 4.6.
