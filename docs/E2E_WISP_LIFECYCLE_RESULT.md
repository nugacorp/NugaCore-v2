# E2E-WISP-1 — Suite E2E de ciclo de vida WISP + preparación CHR real

Fecha: 2026-07-06 · Base: `f8e142e` (main) · Auditable por Hermes.

## Qué se agregó

1. **`tests/e2e/wisp-lifecycle.e2e.test.ts`** — 35 tests E2E contra el stack HTTP
   real en modo hermético (store en memoria, sin red, sin secretos). Recorre la
   operación diaria completa de un WISP:
   - Infraestructura: crear torre (GPS/altura/radio), antena sectorial
     (azimuth/frecuencia), edición de sector, visibilidad en mapa GIS.
   - Alta de cliente: catálogo de planes, reserva de CPE de inventario,
     validaciones 400 (campos, email, IPAM incompleto), flujo IPAM real
     (router → pool → IP disponible → alta con IP validada), edición.
   - Facturación ERP: factura manual, edición (monto/vencimiento), pago parcial,
     rechazo de sobrepago, liquidación, cancelación con razón, balance del
     cliente, pagos como recurso, ciclo de facturación.
   - Suspensión lógica y reactivación manual (sin routers).
   - MikroTik dry-run: registro de router, script de provisioning, test de
     conexión simulado, lecturas read-only mock; asserts de que
     `MIKROTIK_WORKER_LIVE` está apagado y de que no se exponen secretos.
   - RBAC transversal: cobranza/solo-lectura/técnico/anónimo bloqueados donde
     corresponde.

2. **`scripts/chr-smoke.mjs`** — smoke test READ-ONLY del CHR real (REST API
   RouterOS v7, solo GET). Corre en la máquina del operador, no en CI.

3. **`docs/CHR_CONEXION_REAL_RUNBOOK.md`** — RouterOS desde 0 (usuario/grupo
   read-only + rest-api, www-ssl, cert, hardening), conexión por env
   (`ROUTEROS_READONLY_PROVIDER=routeros`), validación y troubleshooting.
   Incluye alta de usuarios del sistema vía Supabase Auth.

## Qué NO se tocó

Sin cambios en backend/frontend de producción. Sin `MIKROTIK_WORKER_LIVE`, sin
commit mode, sin routers reales, sin flags `USE_DB_*` nuevas, sin migraciones.
Contratos API intactos (solo tests y docs aditivos).

## Verificación (2026-07-06)

- `tsc --noEmit` (ambos proyectos): ✅
- `eslint .`: ✅ 0 errores
- `vitest run`: ✅ 149 files / **1804 tests passed** (35 nuevos E2E) / 49 skipped
- `vite build` + `esbuild server.ts`: ✅

## Pendiente para cerrar PROD-4 (acción de Ramiro)

1. Ejecutar §1–§2 del runbook en el CHR de lab.
2. Poner las variables `ROUTEROS_*` en `.env` y correr `node scripts/chr-smoke.mjs`.
3. Verificar `source=live` en Laboratorio MikroTik.
4. Solicitar validación Hermes de PROD-4 con el CHR conectado.
