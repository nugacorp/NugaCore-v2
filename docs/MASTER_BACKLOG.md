# NugaCore — Backlog Maestro (MASTER_BACKLOG)

> Última actualización: 2026-06-01
> Backlog accionable por fases. Cada tarea: **prioridad · complejidad · dependencias.**
> Prioridad: P0 (bloqueante) · P1 (alta) · P2 (media) · P3 (baja). Complejidad: 🟢 S · 🟡 M · 🟠 L · 🔴 XL.

> **Nota:** las "Fases 0–16" del `MASTER_PLAN.md` describen lo ya construido **sobre el mock**. Este backlog reorganiza el trabajo hacia **producción real** (persistencia + seguridad + integraciones), respetando el congelamiento del frontend.

---

## Fase 0 — Estabilización y red de seguridad

> Meta: poder cambiar el sistema sin romperlo. **No tocar UI.**

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F0-1 | Renombrar proyecto (`package.json` `react-example` → `nugacore`) | P2 | 🟢 | — |
| F0-2 | Añadir ESLint + Prettier (typescript-eslint, react-hooks) | P1 | 🟢 | — |
| F0-3 | Configurar framework de pruebas (Vitest) + 1 prueba humo backend y frontend | P0 | 🟡 | — |
| F0-4 | Pruebas de contrato de API v1 (snapshot de los ~25 endpoints núcleo) | P0 | 🟡 | F0-3 |
| F0-5 | CI (GitHub Actions): install, lint, type-check, test, build | P0 | 🟡 | F0-2,F0-3 |
| F0-6 | `Dockerfile` multistage + `.dockerignore` | P1 | 🟡 | build OK |
| F0-7 | `docker-compose` dev (app + Supabase local opcional) | P2 | 🟡 | F0-6 |
| F0-8 | `.gitignore`: excluir symlink `latest` y `.tmp_claude_debug.log` | P3 | 🟢 | — |
| F0-9 | Documentar variables de entorno y secretos (matriz dev/prod) | P1 | 🟢 | — |
| F0-10 | Decisión runtime (Vite+Express vs Next.js) — **registrar ADR** | P0 | 🟢 | — |

**Criterio de salida:** CI verde, build estable, frontend idéntico, suite de contrato API protege el v1.

---

## Fase 1 — Capa de persistencia (dominio piloto: Clientes)

> Meta: un dominio real en DB sin romper el contrato.

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F1-1 | Aplicar migraciones a Supabase staging (init + rls/seeds) | P0 | 🟢 | F0 |
| F1-2 | Extraer `src/types` a `shared/` consumido por front y back | P1 | 🟡 | — |
| F1-3 | Crear `repository.ts` + `mappers.ts` genéricos (snake↔camel) | P0 | 🟠 | F1-1 |
| F1-4 | Implementar repository de **Clientes** + service (mover lógica de la ruta) | P0 | 🟠 | F1-3 |
| F1-5 | Feature flag `USE_DB_CLIENTS` para alternar store↔DB | P0 | 🟢 | F1-4 |
| F1-6 | Reemplazar `getUniqueClientId()` por generación transaccional/secuencia | P1 | 🟡 | F1-4 |
| F1-7 | Migrar timeline de cliente a `client_timeline` | P1 | 🟡 | F1-4 |
| F1-8 | Pruebas de integración Clientes contra DB | P0 | 🟡 | F1-4,F0-3 |

**Criterio de salida:** Clientes leen/escriben en DB con el flag activo; contrato v1 intacto; tests verdes.

---

## Fase 2 — Autenticación real + RBAC de servidor

> Meta: eliminar la dependencia de *trusted headers* (hallazgo S-01).

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F2-1 | Forzar validación de JWT Supabase en todo `/api/*` (middleware global) | P0 | 🟡 | F1-1 |
| F2-2 | Resolver rol **solo** desde `user_roles` (DB), nunca desde header | P0 | 🟡 | F2-1 |
| F2-3 | Retirar/condicionar *trusted headers* a red interna con secreto | P0 | 🟢 | F2-1 |
| F2-4 | Cerrar lecturas abiertas: exigir auth en todos los GET sensibles (S-02) | P0 | 🟡 | F2-1 |
| F2-5 | Flujo de login real en frontend (sin tocar UI) + alta de admin | P0 | 🟡 | F2-1 |
| F2-6 | Token fuera de `localStorage` (cookies httpOnly) — evaluar (S-05) | P1 | 🟠 | F2-5 |
| F2-7 | helmet + rate limit + CORS allowlist + HTTPS/HSTS (S-04) | P0 | 🟡 | — |

**Criterio de salida:** sin Supabase configurado, la API rechaza; el rol no es manipulable por el cliente.

---

## Fase 3 — Migración del resto de dominios a DB

> Orden por riesgo/dependencia (ver [MODULES_ANALYSIS.md](MODULES_ANALYSIS.md) §mapa).

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F3-1 | **Planes** → DB | P0 | 🟢 | F1 |
| F3-2 | **Facturación** → DB (+ trigger `amount_paid`, quitar side-effects de GET) | P0 | 🟠 | F3-1 |
| F3-3 | **Suspensión** → DB (policy + logs) + service de reglas | P1 | 🟡 | F3-2 |
| F3-4 | **Torres + Sectores** → DB | P1 | 🟡 | F1 |
| F3-5 | **FTTH** (OLT/ONU/NAP/nap_ports) → DB + FKs | P1 | 🟠 | F3-4 |
| F3-6 | **Inventario** → DB (+ trigger reconciliación qty/movements) | P1 | 🟡 | F1 |
| F3-7 | **Soporte** (tickets/workorders) → DB + Storage de adjuntos/firmas | P1 | 🟠 | F1, Storage |
| F3-8 | **Dashboard/Monitoreo** → leer de DB (deriva de los anteriores) | P2 | 🟡 | F3-1..3-6 |
| F3-9 | **GIS** → leer de DB (deriva) | P2 | 🟢 | F3-4,3-5 |
| F3-10 | **Finanzas/Owner** → leer de DB (deriva) | P2 | 🟢 | F3-2 |
| F3-11 | Retirar `store.ts` por completo | P1 | 🟡 | F3-1..3-10 |
| F3-12 | Índices faltantes (DATABASE_ANALYSIS §4) | P1 | 🟢 | F3-* |
| F3-13 | Paginación en listados grandes (clientes, facturas) | P1 | 🟡 | API v1 compat |

**Criterio de salida:** ningún dominio depende del store; datos persistentes; performance con índices.

---

## Fase 4 — Integración MikroTik real

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F4-1 | Worker desacoplado + conector RouterOS API (8728/8729 TLS) | P0 | 🔴 | F3 |
| F4-2 | Health check real (CPU/RAM/uptime) reemplaza valores random | P1 | 🟡 | F4-1 |
| F4-3 | Lecturas reales (interfaces/queues/ppp) | P1 | 🟠 | F4-1 |
| F4-4 | Escritura real con `confirmWrite` + auditoría (queues, PPPoE, cortes) | P0 | 🔴 | F4-1 |
| F4-5 | Suspensión/reactivación aplicada en el router (no solo log) | P0 | 🟠 | F4-4, F3-3 |
| F4-6 | Cola de comandos + reintentos + timeouts | P1 | 🟠 | F4-1 |

**Criterio de salida:** acciones reales y seguras sobre routers, totalmente auditadas.

---

## Fase 5 — Automatización y scheduler

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F5-1 | Scheduler/cron (suspensión por vencimiento automática) | P0 | 🟡 | F3-3 |
| F5-2 | Escaneo de monitoreo periódico (ping real) | P1 | 🟠 | F4 |
| F5-3 | Motor de automatizaciones real (`automation_rules` → acciones) | P1 | 🟠 | F5-1 |
| F5-4 | Notificaciones reales (email/WhatsApp/Telegram/push) | P1 | 🟠 | F5-3 |
| F5-5 | Alertas NOC reales basadas en monitoreo | P2 | 🟡 | F5-2 |

---

## Fase 6 — Pagos y CFDI reales

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F6-1 | Integrar pasarela (Stripe/MercadoPago) + webhooks de conciliación | P1 | 🟠 | F3-2 |
| F6-2 | Pagos OXXO/SPEI (referencias) | P2 | 🟠 | F6-1 |
| F6-3 | Timbrado CFDI real con PAC | P1 | 🔴 | F3-2 |
| F6-4 | Generación de PDF de recibo/factura (pdfkit) | P2 | 🟡 | F6-3 |
| F6-5 | Idempotencia en pagos | P1 | 🟡 | F6-1 |

---

## Fase 7 — Hardening, observabilidad y backups

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F7-1 | Logs estructurados (JSON) + niveles + correlación de request | P1 | 🟡 | — |
| F7-2 | Métricas + healthchecks + dashboards de observabilidad | P2 | 🟡 | F7-1 |
| F7-3 | Persistir auditoría + alertas de seguridad (S-10) | P1 | 🟡 | F3 |
| F7-4 | Backups reales de DB (la `backup_policy` deja de ser solo config) | P0 | 🟡 | F3 |
| F7-5 | Retención/particionado de series y auditoría | P2 | 🟡 | F3 |
| F7-6 | `npm audit` + escaneo de dependencias en CI (S-13) | P2 | 🟢 | F0-5 |
| F7-7 | Validación Zod en todos los endpoints de escritura (S-09) | P1 | 🟡 | — |

---

## Fase 8 — Despliegue productivo

| ID | Tarea | Prioridad | Complejidad | Dependencias |
|----|-------|-----------|-------------|--------------|
| F8-1 | VPS aprovisionado + Coolify instalado | P0 | 🟡 | F0-6 |
| F8-2 | Pipeline de deploy (CI → registry → Coolify) | P0 | 🟡 | F0-5,F8-1 |
| F8-3 | Gestión de secretos en Coolify (service-role, MIKROTIK_KEY, etc.) | P0 | 🟡 | F8-1 |
| F8-4 | TLS + dominio + HSTS en el proxy | P0 | 🟢 | F8-1 |
| F8-5 | Estrategia de migraciones en deploy (orden, rollback) | P1 | 🟡 | F3 |
| F8-6 | Runbook de operación + restauración de backup probada | P1 | 🟡 | F7-4 |

---

## Deuda técnica transversal (en paralelo, sin bloquear fases)

| ID | Tarea | Prioridad | Complejidad | Ref |
|----|-------|-----------|-------------|-----|
| DT-1 | Unificar cliente HTTP en `apiClient.ts`, eliminar `fetchJson` | P2 | 🟢 | TD-06 |
| DT-2 | Unificar normalización de roles (un mapa canónico) | P2 | 🟢 | TD-07 |
| DT-3 | Tipar payloads/handlers (quitar `any`) | P2 | 🟡 | TD-04 |
| DT-4 | Eliminar IDs hardcodeados de fallback | P2 | 🟢 | TD-11 |
| DT-5 | Dividir God Components (Finance/Owner, GIS) sin tocar UI | P2 | 🟠 | TD-02/§2 |
| DT-6 | Separar router de tickets ↔ workorders | P3 | 🟡 | TD-02 |
| DT-7 | Centralizar utilidades fecha/ID | P3 | 🟢 | TD-08 |

---

## Resumen de dependencias críticas (camino crítico)

```
F0 (tests+CI) → F1 (repository+Clientes) → F2 (auth real) → F3 (migrar dominios)
                                                                  │
                                          ┌───────────────────────┼───────────────┐
                                          ▼                       ▼               ▼
                                   F4 (MikroTik real)      F5 (automatización)  F6 (pagos/CFDI)
                                          └───────────────────────┴───────────────┘
                                                                  ▼
                                                   F7 (hardening) → F8 (deploy)
```
