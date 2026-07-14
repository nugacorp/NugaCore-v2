# NugaCore — Deuda Técnica (TECHNICAL_DEBT)

> Última actualización: 2026-06-24 (ARCH-1)
> Inventario de deuda: código duplicado, archivos grandes, `any`, acoplamientos, riesgos de mantenimiento.
> Impacto: 🔴 alto · 🟡 medio · 🟢 bajo. Esfuerzo: S (pequeño) · M (medio) · L (grande).

---

## 0. Clasificación ARCH-1 (priorizada con esfuerzo)

Refresco de números y backlog priorizado tras la auditoría ARCH-1. Lo resuelto
en ARCH-1 está marcado ✅; el resto queda como backlog (no se ejecuta en esta
fase para no romper el contrato de tests — FASE M/N).

### Critical
| ID | Deuda | Esfuerzo | Estado |
| --- | --- | --- | --- |
| C-1 | Persistencia en memoria (`state/store.ts`, 889 líneas) como fuente raíz | L | Backlog (TD-01) |
| C-2 | Lógica de negocio en `routes.ts` (falta capa repository/service consistente) | L | Backlog (TD-02) |

### High
| ID | Deuda | Esfuerzo | Estado |
| --- | --- | --- | --- |
| H-1 | `App.tsx` God Container (1337 líneas, fetch total + polling) | M | Backlog — protegido por 18 tests de string; requiere plan de extracción que preserve aserciones |
| H-2 | `CrmModule.tsx` (1910 líneas) | M | Backlog — 5 tests de string |
| H-3 | Sin lazy loading de módulos pesados en `App.tsx` (bundle 1.07 MB) | M | Backlog (FASE H/I) |

### Medium
| ID | Deuda | Esfuerzo | Estado |
| --- | --- | --- | --- |
| M-1 | Duplicación `nowIso` ×12 dominios | S | ✅ Resuelto → `backend/common/time.ts` |
| M-2 | Lectura local de `USE_DB_WIREGUARD` fuera del módulo central de flags | S | ✅ Resuelto → delega en `useDbWireguard()` |
| M-3 | Otros God Components > 600 líneas (RouterOsResources, FinanceOwner, Gis, wizards…) | M | Backlog (FASE B) |
| M-4 | `noUnusedLocals`/`noUnusedParameters` desactivados en `tsconfig` | S | Backlog (FASE I) |

### Low
| ID | Deuda | Esfuerzo | Estado |
| --- | --- | --- | --- |
| L-1 | `nowStamp` (`YYYY-MM-DD HH:mm`) con variantes no idénticas | S | Backlog — unificar tras normalizar formato |
| L-2 | Helpers de formato de moneda repetidos en frontend | S | Backlog |
| L-3 | Providers con dos formas (mock/real vs por-pasarela) | S | Backlog — estandarizar solo dominios con backend externo |

> **Nota de seguridad/calidad (FASE M):** ARCH-1 no cambió endpoints, payloads,
> RBAC, feature flags ni tests existentes. Los refactors fueron additive
> (`time.ts`) o por delegación (flag WireGuard), con `typecheck`, `npm test`
> (1712 passed) y `build` en verde.

---

## 1. Deuda estructural (la más cara)

### TD-01 🔴 Persistencia en memoria (store mock) · L
**Dónde:** `backend/state/store.ts` (791 líneas).
Todo el estado vive en arreglos en memoria. Se pierde al reiniciar, impide escalar horizontalmente y mezcla *datos semilla* con *lógica de generación de IDs* y *helpers de bitácora*. Es la deuda raíz que condiciona casi todo lo demás.
**Acción:** introducir capa repository + Supabase (ver [DATABASE_ANALYSIS.md](./DATABASE_ANALYSIS.md)).

### TD-02 🔴 Ausencia de capa repository / service · L
**Dónde:** `backend/domains/*/routes.ts`.
Las rutas mezclan HTTP, validación, reglas de negocio y acceso a datos. Ejemplo: la **reactivación automática del cliente** vive dentro de `billing/routes.ts` (`/pay`), y la conversión de lead con generación de factura/ONU vive en `customers/routes.ts` (`POST`). Migrar a DB sin extraer esta lógica multiplicará el riesgo.
**Acción:** `routes → service → repository` por dominio.

### TD-03 🔴 `App.tsx` como God Container · M
**Dónde:** `src/App.tsx` (641 líneas).
Concentra **todo** el estado de la app y **todos** los handlers (≈20). Cada mutación hace un **refetch total** (`fetchData()` con 13 requests en paralelo) y hay polling cada 60 s. Re-render global en cada cambio.
**Acción (sin tocar UI):** extraer servicios por dominio y hooks de datos; reusar `apiClient.ts`.

---

## 2. Archivos grandes (God Components)

| Archivo | Líneas | Impacto | Nota |
|---------|--------|---------|------|
| `src/components/FinanceOwnerModule.tsx` | 1086 | 🔴 | Dos vistas (finance/owner) acopladas en un archivo |
| `src/components/GisModule.tsx` | 1075 | 🔴 | Lógica geoespacial densa |
| `src/components/Dashboard.tsx` | 841 | 🟡 | KPIs + alertas + monitoreo |
| `src/components/NetworkModule.tsx` | 825 | 🟡 | Torres + FTTH + sectores |
| `backend/state/store.ts` | 791 | 🔴 | Ver TD-01 |
| `src/components/LandingPage.tsx` | 682 | 🟢 | Marketing, baja rotación |
| `backend/domains/tickets/routes.ts` | 647 | 🟡 | Tickets + workorders en un router |
| `src/App.tsx` | 641 | 🔴 | Ver TD-03 |

**Acción:** dividir por sub-vista/sub-recurso **sin alterar el markup** (extraer subcomponentes y helpers). Prioridad: Finance/Owner y GIS por tamaño; tickets-router por separación de recursos.

---

## 3. Tipado (`any` y pérdida de seguridad de tipos)

### TD-04 🟡 `any` extendido · M
**Dónde:**
- `src/App.tsx`: `stats: any`, `mikrotikLogs: any[]`, y casi todos los handlers reciben `any` (`newClientData: any`, `invoiceData: any`, `onuData: any`, `itemData: any`, …).
- Backend: `(mappedRole as any)` en `auth-context.ts`; cuerpos `req.body` sin tipar.
**Impacto:** el compilador no protege las mutaciones; los contratos de payload son implícitos.
**Acción:** tipar payloads (idealmente con esquemas Zod compartidos front/back) y respuestas de agregación (stats, monitoring).

### TD-05 🟢 `lint` = solo `tsc --noEmit` · S
No hay ESLint ni Prettier. El único check es type-check. Sin reglas de estilo, imports, hooks de React, etc.
**Acción:** añadir ESLint (typescript-eslint + react-hooks) y Prettier; integrarlos en CI.

---

## 4. Código duplicado

### TD-06 🟡 Cliente HTTP duplicado · S
`src/lib/apiClient.ts` (cliente tipado con manejo de errores) **existe pero no se usa**: `App.tsx` implementa su propio `fetchJson` con `getAuthHeaders`. Dos formas de llamar a la API.
**Acción:** unificar en `apiClient.ts` (añadirle el inyector de headers de auth) y eliminar `fetchJson`.

### TD-07 🟡 Normalización de roles duplicada · S
La lógica de normalizar roles existe **dos veces**: `backend/common/rbac.ts → normalizeRole` y `src/lib/supabase.ts → normalizeUserRole` (con vocabularios distintos: backend en minúsculas inglés/español, frontend en formato display `Super Admin`). Riesgo de divergencia.
**Acción:** definir un único mapa canónico y derivar las etiquetas de presentación.

### TD-08 🟡 Sellos de tiempo y generación de IDs repetidos · S
`new Date().toISOString().replace('T',' ').substring(0,16)` y los `getUnique*Id()` se repiten en múltiples archivos/funciones. Helpers `nowStamp()` duplicados en varios routers.
**Acción:** centralizar utilidades de fecha/ID (y reemplazar generación de IDs por la DB — ver TD-01).

### TD-09 🟢 Patrón CRUD repetido por dominio · M
Cada router repite el patrón find/validate/push/filter sobre el store. Al migrar conviene un repository genérico parametrizado para reducir boilerplate.

---

## 5. Acoplamientos

### TD-10 🟡 Backend importa tipos del frontend · M
**Dónde:** los routers y el store importan de `../../src/types` (`import { Client } from '../../../src/types'`).
Es coherente con "el frontend es la fuente de verdad", pero acopla el build del backend al árbol del frontend y complica una eventual separación de procesos/paquetes.
**Acción:** extraer `types` a un paquete/carpeta compartida (`shared/`) consumida por ambos.

### TD-11 🟡 IDs hardcodeados como fallback · S
**Dónde:** `CrmModule.tsx` (`plans[0]?.id || 'plan-basic'`), `NetworkModule.tsx` (`olts[0]?.id || 'olt-1'`), backend (`planId || 'plan-basic'`, `oltId: 'olt-1'`).
Acopla el código a slugs concretos de datos semilla.
**Acción:** eliminar fallbacks; manejar estados vacíos explícitamente.

### TD-12 🟡 `store` global mutable compartido · M
Todos los routers importan y mutan el mismo objeto `store`. Estado global mutable = difícil de testear y de razonar; imposible en multi-instancia.
**Acción:** se resuelve con repository + DB (TD-01/TD-02).

### TD-13 🟢 Lecturas con efectos secundarios · S
`GET /api/billing/invoices` muta estados (`syncInvoiceStatus`). Viola la expectativa de que GET es idempotente/sin efectos.
**Acción:** mover el recálculo a writes o columnas calculadas.

---

## 6. Riesgos de mantenimiento

| ID | Riesgo | Impacto |
|----|--------|---------|
| TD-14 🔴 | **Sin pruebas automatizadas** (unit/integration/e2e) | Cualquier migración a DB puede romper en silencio |
| TD-15 🔴 | **Sin CI/CD** | No hay gate de calidad antes de merge/deploy |
| TD-16 🟡 | **Sin Dockerfile ni manifiestos de deploy** | Despliegue manual, no reproducible |
| TD-17 🟡 | **Logger casero** (`console` envuelto) sin niveles/estructura | Difícil de observar en prod |
| TD-18 🟡 | **MikroTik 100% simulado** | La funcionalidad OSS no es real; el "modo simulado" puede confundirse con real |
| TD-19 🟢 | **Modelo Gemini `gemini-3.5-flash`** (nombre dudoso) | Solo copiloto, con fallback |
| TD-20 🟢 | **`package.json name: "react-example"`** | Identidad del proyecto incorrecta |
| TD-21 🟢 | **Comentario corrupto** en `vite.config.ts` (`modifyâfile`) | Cosmético (encoding) |
| TD-22 🟢 | **Symlink `latest`** apuntando a log de depuración de Claude en el repo | Ruido; añadir a `.gitignore` |
| TD-23 🟡 | **Documentación de "fases 0–16" describe avance sobre el mock** | Puede dar falsa sensación de "terminado" |

---

## 7. Lo que está BIEN (no es deuda)

Para balancear, vale documentar las fortalezas que **conviene conservar**:
- Arquitectura backend **modular por dominio** limpia.
- **Crypto AES-256-GCM** correcto y con guardas de producción.
- **Sanitización de credenciales** MikroTik (`sanitizeRouter`).
- **Política de comandos** read/write con confirmación y auditoría.
- **Esquema SQL** maduro y alineado al contrato de datos.
- **RLS deny-by-default** + seeds de catálogos.
- **Manejo gracioso de degradación** (Supabase/Gemini opcionales con fallback).
- **Tipos del frontend** ricos y consistentes (`src/types.ts`).

---

## 8. Priorización de pago de deuda

| Orden | Ítems | Cuándo |
|-------|-------|--------|
| 1 | TD-14, TD-15, TD-05 (tests + CI + lint) | **Antes** de migrar datos (red de seguridad) |
| 2 | TD-02 (repository/service) | Habilita la migración a DB |
| 3 | TD-01, TD-12, TD-08, TD-13 (DB y consecuencias) | Migración por dominios |
| 4 | TD-06, TD-07, TD-04, TD-11 (limpieza front/contratos) | En paralelo, sin tocar UI |
| 5 | TD-03, archivos grandes (§2) | Refactor progresivo, sin cambios visuales |
| 6 | TD-16, TD-17 (deploy/observabilidad) | Antes de producción |
| 7 | TD-18, TD-19 (MikroTik real, IA) | Fase de integraciones |
| 8 | TD-20, TD-21, TD-22 (cosméticos) | Cuando convenga |
