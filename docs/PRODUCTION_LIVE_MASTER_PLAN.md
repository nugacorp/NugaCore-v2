# NugaCore — Production Live Master Plan

> **Documento maestro para Claude Code, Codex, Hermes y el equipo de desarrollo**
>
> **Objetivo:** llevar NugaCore desde su estado actual de desarrollo/staging hasta una operación live, segura, recuperable y auditable.
>
> **Principio:** desarrollar poco a poco, una fase a la vez, con validación obligatoria antes de avanzar.
>
> **Regla principal:** este documento define el orden de ejecución. Ningún agente debe saltar fases, activar gates live o conectar infraestructura real sin autorización explícita.

---

# 1. Objetivo del producto

NugaCore es una plataforma SaaS/ERP para WISP e ISP que debe administrar:

* Empresas WISP separadas por tenant.
* Usuarios y roles.
* Clientes.
* Servicios de internet.
* Planes.
* Facturación.
* Cobranza.
* Pagos.
* Suspensiones y reactivaciones.
* Tickets y soporte.
* CRM comercial.
* Inventario.
* Torres y sitios.
* Infraestructura de red.
* Routers MikroTik.
* WireGuard.
* NOC.
* FTTH y GIS.
* Documentos.
* Reportes.
* Automatizaciones.
* Notificaciones.
* Portal de clientes.
* Operación auditada y segura.

El objetivo de producción inicial no es activar todas las automatizaciones.

El objetivo inicial es operar el WISP real con:

* datos reales;
* usuarios reales;
* seguridad real;
* backups;
* persistencia;
* operación manual segura;
* monitoreo;
* capacidad de recuperación.

Las automatizaciones, pagos live, notificaciones live y RouterOS write se activarán posteriormente mediante gates graduales.

---

# 2. Estado actual asumido

Antes de trabajar, Claude Code debe verificar el estado real del repositorio.

No debe asumir que este documento está completamente actualizado.

Debe leer:

* `README.md`
* `ROADMAP.md`
* `reports/PROJECT_STATUS_CURRENT.md`
* `reports/REPO_REVIEW_2026-07-15_29.md`
* `deployment/SUPABASE_MIGRATIONS_SYNC.md`
* `deployment/PRODUCTION_READINESS_CHECKLIST.md`
* `results/NOTIFICATION_ENGINE_FOUNDATION_RESULT.md`
* documentos de arquitectura;
* documentos de technical debt;
* documentos de validación Hermes;
* migraciones;
* feature flags;
* production gates.

Debe ejecutar:

```bash
git status --short --branch
git log --oneline -30
git remote -v
git stash list
npm run typecheck
npm test
npm run build
```

Debe reportar:

* rama actual;
* commit HEAD;
* sincronización con `origin/main`;
* working tree;
* stashes;
* resultado de tests;
* resultado del build;
* fases implementadas;
* fases validadas;
* fases pendientes.

---

# 3. Filosofía operativa

Toda capacidad peligrosa debe recorrer esta secuencia:

```text
Read-only
→ Dry-run
→ Simulación
→ Aprobación humana
→ Laboratorio
→ Piloto controlado
→ Live limitado
→ Live ampliado
```

Nunca se debe saltar directamente de mock a producción.

---

# 4. Reglas para Claude Code

Claude Code es el agente principal de implementación.

Debe trabajar con estas reglas.

## 4.1 Una sola fase a la vez

Claude no debe implementar varias fases de este plan en una sola entrega.

Cada fase debe dividirse en entregas pequeñas.

Ejemplo:

```text
PR-1A.1
PR-1A.2
PR-1A.3
```

No debe crear un mega commit que modifique seguridad, base de datos, RouterOS y pagos simultáneamente.

---

## 4.2 No trabajar directamente sobre main

Usar una rama por fase.

Ejemplos:

```text
release/production-readiness
feature/pr1-mt01-notify-invoice
feature/pr1-mt02-tenant-resolution
feature/pr2-migration-ci
feature/pr3-backup-restore
```

Cada rama debe terminar en Pull Request.

---

## 4.3 No activar producción automáticamente

Claude Code no puede activar por sí solo:

* `LIVE_MODE`;
* `MIKROTIK_WORKER_LIVE`;
* `MIKROTIK_WORKER_COMMIT`;
* `NOTIFICATIONS_LIVE`;
* `AUTOMATION_EXECUTE`;
* `PROVISIONING_EXECUTE`;
* `PAYMENTS_ROUTER_LIVE`;
* `SAFE_COMMAND_QUEUE_LIVE`;
* `SERVICE_STATUS_LIVE`;
* credenciales reales;
* webhooks reales;
* pagos reales;
* envío real de mensajes;
* RouterOS write;
* suspensión automática;
* reactivación automática.

Estas acciones requieren autorización explícita del propietario.

---

## 4.4 No guardar secretos

Nunca hacer commit de:

* JWT;
* service role;
* contraseñas;
* claves privadas;
* claves WireGuard;
* preshared keys;
* credenciales MikroTik;
* tokens OpenPay;
* tokens WhatsApp;
* tokens Telegram;
* SMTP credentials;
* claves PAC;
* secretos de webhooks;
* variables de producción.

Usar únicamente variables de entorno y secret managers.

---

## 4.5 Verificar antes de modificar

Antes de cambiar un módulo, Claude debe:

1. Leer implementación actual.
2. Leer tests existentes.
3. Leer migraciones relacionadas.
4. Identificar contratos públicos.
5. Identificar feature flags.
6. Identificar production gates.
7. Identificar riesgos multi-tenant.
8. Explicar el cambio propuesto.
9. Implementar.
10. Ejecutar validación.

---

## 4.6 Definición de entrega

Cada entrega debe incluir:

* alcance;
* archivos modificados;
* migraciones;
* endpoints;
* cambios de contrato;
* riesgos;
* pruebas;
* resultado de typecheck;
* resultado de tests;
* resultado de build;
* instrucciones para Hermes;
* rollback;
* siguiente paso sugerido.

---

# 5. Agentes y responsabilidades

## Claude Code

Responsable de:

* implementación principal;
* refactors;
* migraciones;
* tests;
* documentación;
* preparación de PR.

## Codex

Responsable de:

* revisión independiente;
* análisis de seguridad;
* pruebas adversariales;
* revisión de tenant isolation;
* revisión de migraciones;
* búsqueda de regresiones.

## ChatGPT

Responsable de:

* arquitectura;
* plan de producto;
* división de fases;
* prompts;
* evaluación de reportes;
* decisiones sobre el siguiente paso.

## GitHub Copilot

Uso limitado a:

* autocompletado;
* tests pequeños;
* documentación;
* fixes locales;
* ayuda dentro del editor.

## Gemini

Uso secundario para:

* revisión documental;
* análisis de frontend;
* consistencia;
* segunda opinión;
* auditorías amplias.

## Hermes

Responsable de:

* deploy en staging;
* smoke tests;
* validación post-deploy;
* comprobación de logs;
* comprobación de healthchecks;
* creación de evidencia;
* validación de gates.

Hermes no debe desarrollar funcionalidades sobre `main`.

---

# 6. Flujo de desarrollo obligatorio

```text
1. ChatGPT define la fase.
2. Claude Code analiza el repo.
3. Claude Code crea una rama.
4. Claude implementa una entrega pequeña.
5. Claude ejecuta tests.
6. Claude abre PR.
7. Codex revisa.
8. Claude corrige.
9. CI valida.
10. Se fusiona.
11. Hermes despliega staging.
12. Hermes valida.
13. Ramiro aprueba.
14. Se avanza a la siguiente entrega.
```

---

# 7. Estados oficiales de una funcionalidad

No usar solamente la palabra “implementado”.

Cada módulo debe tener uno de estos estados:

```text
PLANNED
IMPLEMENTED
UNIT_TESTED
INTEGRATION_TESTED
STAGING_VALIDATED
LAB_VALIDATED
PILOT_VALIDATED
PRODUCTION_READY
LIVE
```

Una funcionalidad no es `PRODUCTION_READY` solo porque compile o tenga tests unitarios.

---

# 8. Roadmap de producción

---

# PHASE PR-0 — Scope Freeze and Baseline

## Objetivo

Congelar el alcance de la primera versión productiva.

No agregar módulos nuevos.

## Incluir en producción inicial

* Auth y RBAC.
* Multi-tenant.
* Clientes.
* Planes.
* Servicios.
* Facturación.
* Cobranza.
* Pagos manuales.
* Inventario.
* Tickets.
* CRM.
* NOC read-only.
* Routers.
* WireGuard.
* Documentos.
* Reportes básicos.
* Portal de cliente básico.
* Operación manual segura.

## Mantener desactivado inicialmente

* RouterOS write.
* Suspensión automática.
* Reactivación automática.
* Notificaciones reales.
* Automation execute.
* Provisioning execute.
* CFDI real.
* OLT worker.
* Operaciones masivas.
* Pagos reales si no han sido validados E2E.

## Entregables

Crear:

```text
docs/releases/V3_SCOPE.md
docs/releases/V3_NON_GOALS.md
docs/releases/V3_RELEASE_GATES.md
```

## Gate de salida

* alcance aprobado;
* lista de funciones excluidas;
* feature freeze aceptado;
* baseline de tests registrado.

---

# PHASE PR-1 — Multi-Tenant Security Hardening

Esta es la fase más importante.

No avanzar a datos reales ni producción antes de cerrarla.

---

## PR-1A — Corregir MT-01

### Problema

`notifyInvoice` realiza operaciones sin aplicar tenant consistentemente.

### Trabajo

Asegurar `tenant_id` en:

* factura;
* cliente;
* torre;
* timeline;
* mensajes;
* notificaciones;
* auditoría;
* cualquier consulta relacionada.

### Reglas

Toda consulta debe utilizar:

```text
tenant_id + resource_id
```

Nunca consultar solo por `id`.

### Tests

Crear dos tenants:

```text
tenant-a
tenant-b
```

Validar:

* tenant A no puede notificar factura B;
* tenant A no puede leer factura B;
* tenant A no puede escribir timeline B;
* tenant A no puede resolver cliente B;
* IDs existentes en otro tenant no filtran información;
* auditoría registra tenant correcto.

### Gate

* MT-01 cerrado;
* tests adversariales PASS;
* revisión Codex PASS;
* validación Hermes PASS.

---

## PR-1B — Corregir MT-02

### Problema

La resolución de tenant falla hacia `tenant-default`.

### Regla obligatoria

```text
No membership → 403
Invalid JWT → 401
Tenant not found → 403
Ambiguous tenant → 409 o 403
DB failure → 503
```

Nunca debe existir fallback de seguridad hacia un tenant predeterminado.

### Trabajo

* eliminar fallback;
* tipar errores;
* revisar middleware;
* revisar tests;
* revisar servicios que asumen tenant default;
* bloquear inicio si falta configuración crítica.

### Tests

* usuario sin membership;
* error de DB;
* membership duplicada;
* tenant deshabilitado;
* token válido sin tenant;
* token de tenant A intentando seleccionar B.

### Gate

* cero fallback a `tenant-default`;
* MT-02 cerrado;
* tests de error PASS;
* revisión independiente PASS.

---

## PR-1C — Corregir MT-03

### Trabajo

Persistir siempre `tenant_id` en:

* `wisp_integration_settings`;
* configuraciones de proveedor;
* credenciales cifradas;
* cualquier repositorio relacionado.

### Gate

* lectura tenant-scoped;
* escritura tenant-scoped;
* actualización tenant-scoped;
* tests cruzados PASS.

---

## PR-1D — Corregir MT-04

### Trabajo

Hacer `tenantId` obligatorio en todos los contratos de pagos.

Prohibido:

```ts
tenantId?: string
```

Requerido:

```ts
tenantId: string
```

Revisar:

* payments;
* webhooks;
* reconciliation;
* invoices;
* refunds;
* provider events;
* idempotency;
* queries con service role.

### Gate

* cero método global accidental;
* contratos compilados;
* tests tenant A/B PASS.

---

## PR-1E — Corregir MT-05

### Trabajo de base de datos

Agregar:

```sql
UNIQUE (tenant_id, id)
```

en tablas relevantes.

Crear claves foráneas compuestas:

```sql
FOREIGN KEY (tenant_id, customer_id)
REFERENCES customers (tenant_id, id)
```

Aplicar a:

* invoices;
* payments;
* services;
* tickets;
* inventory;
* routers;
* towers;
* notifications;
* automation;
* provisioning;
* cualquier relación entre recursos tenant-scoped.

### Requisitos

* migración idempotente;
* estrategia de datos existentes;
* validación previa;
* rollback documentado;
* pruebas en DB temporal;
* pruebas staging.

### Gate

* FK cross-tenant imposible;
* migración desde cero PASS;
* upgrade PASS;
* staging PASS.

---

## PR-1F — Corregir MT-06

### Problema

Webhook CoDi puede caer a tenant default.

### Trabajo

Resolver tenant por:

* configuración de proveedor;
* cuenta;
* identificador comercial;
* webhook secret;
* merchant ID;
* mapping explícito.

Nunca por fallback.

### Gate

* webhook sin tenant reconocido → rechazo;
* tenant A no impacta B;
* replay protection;
* idempotencia;
* logs seguros.

---

## PR-1G — Tenant Scoped Repository Layer

### Objetivo

Evitar depender de disciplina manual.

Crear una capa común:

```ts
createTenantRepository({
  adminClient,
  tenantId,
});
```

Toda operación debe quedar preconfigurada con tenant.

### Reglas

* `tenantId` obligatorio;
* no aceptar tenant opcional;
* no exponer `adminClient` libremente en servicios nuevos;
* helpers globales solo para tablas globales documentadas;
* toda excepción debe justificarse.

### Gate PR-1

* MT-01 a MT-06 cerrados;
* cero fallback tenant default;
* pruebas cruzadas completas;
* auditoría de service role;
* revisión Codex;
* validación Hermes.

---

# PHASE PR-2 — Database Integrity and Migration Safety

## PR-2A — Migration Version Validation

Agregar CI que falle si existen prefijos duplicados.

Ejecutar:

```bash
ls supabase/migrations |
sed -E 's/_.*//' |
sort |
uniq -d
```

Debe devolver vacío.

También validar:

* nombres;
* timestamps;
* SQL vacío;
* archivos duplicados;
* migraciones no ordenadas.

---

## PR-2B — Fresh Database Test

Levantar una base temporal y ejecutar todas las migraciones desde cero.

Comprobar:

* tablas;
* índices;
* RLS;
* constraints;
* tenant_id;
* funciones;
* triggers;
* Storage;
* seeds mínimos.

---

## PR-2C — Upgrade Path Test

Probar migración desde una versión anterior representativa.

```text
snapshot anterior
→ aplicar nuevas migraciones
→ verificar integridad
```

---

## PR-2D — Drift Detection

Comparar:

```text
repo
staging
production
```

Detectar:

* migraciones faltantes;
* columnas faltantes;
* tipos distintos;
* políticas RLS distintas;
* índices faltantes;
* constraints faltantes.

---

## Gate PR-2

* duplicados = 0;
* fresh migration = PASS;
* upgrade migration = PASS;
* drift = 0;
* tablas públicas sin RLS = 0;
* tablas multi-tenant sin `tenant_id` = 0.

---

# PHASE PR-3 — Full Persistence

## Objetivo

Eliminar estados críticos en memoria.

## Dominios prioritarios

* MIKROTIK.
* NETWORK.
* GIS.
* AUTOMATIONS.
* REPORTS.
* SECURITY.
* DASHBOARD, cuando dependa de datos persistentes.

## PR-3A — MikroTik Persistence

Persistir:

* routers;
* interfaces;
* addresses;
* routes;
* status;
* credentials metadata;
* enrollment relation;
* WireGuard relation;
* tower relation;
* tenant relation;
* last known health;
* connection state.

No persistir secretos en texto plano.

---

## PR-3B — Network Persistence

Persistir:

* towers;
* sites;
* sectors;
* links;
* topology;
* pools;
* assignments;
* reservations;
* service relations.

---

## PR-3C — GIS Persistence

Persistir:

* locations;
* coordinates;
* geometries;
* coverage;
* routes;
* NAP;
* FTTH elements;
* GeoJSON metadata.

---

## PR-3D — Restart Resilience

Pruebas obligatorias:

```text
crear datos
→ reiniciar API
→ verificar
→ reiniciar worker
→ verificar
→ redeploy
→ verificar
→ reiniciar VPS de staging
→ verificar
```

## Gate PR-3

* datos críticos sobreviven;
* mocks no aparecen en producción;
* flags DB activados;
* aislamiento tenant PASS;
* zero data loss en reinicio.

---

# PHASE PR-4 — Backup and Disaster Recovery

## PR-4A — Database Backup

Implementar:

* backup diario;
* backup completo semanal;
* cifrado;
* checksum;
* retención;
* copia externa;
* monitoreo de backup.

---

## PR-4B — Storage Backup

Respaldar:

* client documents;
* invoices;
* router backups;
* exports;
* uploaded assets.

---

## PR-4C — Infrastructure Backup

Respaldar:

* configuración Coolify;
* variables de entorno, cifradas;
* WireGuard;
* host-apply;
* Docker Compose;
* configuración de observabilidad;
* certificados y referencias;
* runbooks.

---

## PR-4D — Restore Drill

Restaurar en ambiente limpio:

```text
backup
→ nueva infraestructura
→ DB restore
→ Storage restore
→ migraciones
→ deploy
→ login
→ validación funcional
```

Comprobar:

* clientes;
* facturas;
* pagos;
* documentos;
* routers;
* WireGuard;
* inventario;
* tickets.

## Objetivos iniciales

```text
RPO: 24 horas
RTO: 4 a 8 horas
```

## Gate PR-4

* backup automático PASS;
* restore completo PASS;
* checksum PASS;
* evidencia guardada;
* runbook aprobado;
* alerta de backup fallido probada.

---

# PHASE PR-5 — Application Security Hardening

## PR-5A — Authentication

* Supabase JWT validado.
* Issuer validado.
* Audience validado.
* Expiration validada.
* Roles únicamente desde DB.
* Trusted headers desactivados.
* Sesiones revocables.
* MFA para Super Admin.
* MFA recomendado para Admin.

---

## PR-5B — Authorization

Crear matriz:

```text
role × endpoint × action
```

Probar:

* allow;
* deny;
* tenant mismatch;
* recurso inexistente;
* recurso de otro tenant;
* acciones sensibles.

---

## PR-5C — HTTP Security

Validar:

* HTTPS;
* HSTS;
* CSP;
* CORS allowlist;
* rate limiting;
* body limit;
* JSON parser;
* secure cookies cuando apliquen;
* headers seguros;
* errores sin stack.

---

## PR-5D — Input and Business Validation

* Zod en inputs.
* Protección mass assignment.
* Validación de IDs.
* Validación de estados.
* Límites de paginación.
* Límites de exportación.
* Sanitización de texto.
* Validación de archivos.
* Idempotencia.

---

## PR-5E — Secrets and Logs

* secret scanning;
* redaction;
* no JWT;
* no passwords;
* no private keys;
* no API tokens;
* no credential payloads;
* no RouterOS secrets;
* audit logs seguros.

---

## PR-5F — Dependency Security

* npm audit;
* Dependabot o Renovate;
* SBOM;
* image scan;
* lockfile obligatorio;
* revisión de paquetes críticos.

---

## Gate PR-5

* vulnerabilidades críticas = 0;
* pruebas RBAC PASS;
* secret scan PASS;
* tenant tests PASS;
* OWASP staging review PASS;
* Codex security review PASS.

---

# PHASE PR-6 — CI/CD and Release Management

## Pipeline por Pull Request

Ejecutar:

```text
format
lint
typecheck
unit tests
contract tests
integration tests
multi-tenant tests
migration validation
fresh DB test
build frontend
build backend
Docker build
secret scan
dependency scan
static safety
```

## Ambientes

```text
local
CI temporal
staging
production
```

Staging y producción deben tener:

* DB separada;
* Storage separado;
* variables separadas;
* dominios separados;
* WireGuard separado;
* routers separados;
* secrets separados.

## Deploy

Configurar:

* imagen por commit;
* healthcheck;
* readiness;
* liveness;
* migraciones como job controlado;
* deploy con aprobación;
* smoke test;
* rollback;
* registro de versión.

## Gate PR-6

* CI obligatoria;
* branch protection;
* no direct push a main;
* rollback probado;
* staging estable;
* producción no accesible desde pruebas.

---

# PHASE PR-7 — Observability

## Componentes

* métricas;
* dashboards;
* logs;
* errores;
* uptime;
* alertas.

## Métricas mínimas

* API latency;
* API 4xx/5xx;
* DB connections;
* DB errors;
* worker status;
* queue depth;
* job duration;
* failed jobs;
* webhook failures;
* router status;
* WireGuard handshake age;
* disk;
* CPU;
* RAM;
* backup status.

## Alertas

* API caída;
* DB caída;
* 5xx alto;
* disco > 80%;
* worker caído;
* queue estancada;
* backup fallido;
* webhook agotado;
* router crítico offline;
* WireGuard stale;
* certificado próximo a vencer.

## Gate PR-7

Cada alerta debe probarse mediante un fallo controlado.

---

# PHASE PR-8 — Real Data Import

## Fuente

Importar desde el sistema WISP actual.

## Datos

* tenants;
* usuarios;
* clientes;
* planes;
* servicios;
* saldos;
* facturas;
* pagos;
* torres;
* routers;
* IP;
* equipos;
* inventario;
* tickets abiertos.

## Proceso

```text
exportar
→ staging de importación
→ limpiar
→ normalizar
→ validar
→ importar
→ conciliar
→ aprobar
```

## Validaciones

```text
clientes origen = clientes destino
saldos origen = saldos destino
IPs duplicadas = 0
facturas huérfanas = 0
pagos huérfanos = 0
servicios huérfanos = 0
routers sin tenant = 0
```

## Gates live durante importación

Mantener:

```text
RouterOS write OFF
Automation execute OFF
Notifications live OFF
Provisioning execute OFF
Suspension live OFF
Payments router live OFF
```

---

# PHASE PR-9 — Parallel Operation

Operar NugaCore en paralelo con el sistema actual.

## Duración

Mínimo recomendado:

```text
2 a 4 semanas
```

## Conciliación diaria

Comparar:

* clientes;
* activos;
* suspendidos;
* pagos;
* ingresos;
* saldos;
* facturas;
* tickets;
* inventario;
* routers;
* alertas.

## Gate PR-9

* diferencias financieras inexplicadas = 0;
* pérdida de datos = 0;
* fuga tenant = 0;
* backups correctos;
* restore probado;
* usuarios capacitados;
* runbooks terminados.

---

# PHASE PR-10 — Payments Live

## Secuencia

```text
mock
→ unit tests
→ integration tests
→ sandbox
→ staging
→ producción limitada
→ conciliación
→ producción ampliada
```

## Primer proveedor

Activar solo uno inicialmente.

Ejemplo:

```text
OpenPay sandbox
→ OpenPay production limited
```

## Validar

* firma;
* idempotencia;
* replay;
* eventos fuera de orden;
* duplicados;
* reversos;
* tenant resolution;
* retry;
* dead-letter;
* conciliación;
* proveedor caído.

## Regla inicial

Un pago no debe reactivar automáticamente.

Flujo inicial:

```text
pago confirmado
→ conciliación
→ decisión propuesta
→ aprobación humana
→ acción manual
```

---

# PHASE PR-11 — RouterOS Laboratory Execution

## PR-11A — CHR Dry-Run

Conectar Safe Command Queue a CHR.

Sin commit real.

Validar:

* conectividad;
* timeout;
* resultados;
* auditoría;
* rollback plan;
* allowlist.

---

## PR-11B — First Reversible Command

Primer comando real:

* inocuo;
* reversible;
* una sola ejecución;
* un CHR;
* aprobación humana;
* backup previo.

No usar suspensión como primer comando.

Ejemplo:

```routeros
/system note set note="NugaCore lab validation"
```

---

## PR-11C — Circuit Breaker

Implementar:

* kill switch;
* maximum concurrency;
* maximum routers;
* timeout;
* retries limitados;
* idempotency;
* denylist;
* allowlist;
* rollback;
* health verification.

---

## PR-11D — Non-Critical Router Pilot

Piloto:

* un router no crítico;
* horario programado;
* técnico disponible;
* acceso alterno;
* backup;
* rollback;
* observación posterior.

## Gate PR-11

* CHR PASS;
* comando reversible PASS;
* circuit breaker PASS;
* auditoría PASS;
* piloto autorizado.

---

# PHASE PR-12 — Service Suspension and Reactivation

## Suspensión

```text
mora detectada
→ Billing verifica
→ Automation propone
→ Provisioning crea plan
→ aprobación humana
→ Worker ejecuta
→ verifica
→ Service Status actualiza
→ auditoría
```

## Reactivación

```text
pago confirmado
→ conciliado
→ decisión
→ aprobación humana
→ worker reactiva
→ verifica
→ auditoría
```

## Rollout

```text
1 cliente
→ 5 clientes
→ 20 clientes
→ lote controlado
```

Nunca ejecutar toda la cartera de golpe.

---

# PHASE PR-13 — Notifications Live

Activar un canal por fase.

Orden sugerido:

```text
Email
→ Telegram interno
→ WhatsApp
→ Push
```

Cada canal debe tener:

* credenciales cifradas;
* tenant isolation;
* plantillas;
* preview;
* rate limit;
* opt-out;
* retries;
* deduplicación;
* estados;
* auditoría;
* protección contra envío masivo.

## Gate

* sandbox PASS;
* prueba limitada PASS;
* envío accidental masivo imposible;
* cancelación y rate limit probados.

---

# PHASE PR-14 — Automation Live

Activar una automatización a la vez.

Orden sugerido:

1. Alertas internas.
2. Recordatorios.
3. Creación de tareas.
4. Notificaciones.
5. Acciones de servicio con aprobación.
6. Acciones automáticas limitadas.

Nunca comenzar con suspensión masiva automática.

---

# PHASE PR-15 — Production Launch

## Fase piloto

Comenzar con:

* WISP propio;
* un tenant;
* usuarios internos;
* operación manual;
* pagos limitados;
* RouterOS write limitado;
* notificaciones limitadas.

## Cutover

1. Congelar cambios en sistema anterior.
2. Exportar delta.
3. Importar delta.
4. Conciliar.
5. Ejecutar backup.
6. Ejecutar smoke tests.
7. Autorizar apertura.
8. Monitorear.
9. Mantener rollback.

## Primeros 30 días

* revisar logs diariamente;
* conciliar pagos diariamente;
* revisar backups diariamente;
* auditar roles semanalmente;
* auditar operaciones MikroTik;
* limitar automatizaciones;
* documentar incidentes;
* corregir antes de ampliar.

---

# 9. Definition of Done por entrega

Cada entrega debe cumplir:

```text
[ ] Alcance pequeño y definido
[ ] Tests nuevos
[ ] Tests existentes pasan
[ ] Typecheck pasa
[ ] Build pasa
[ ] Sin secretos
[ ] Tenant isolation validado
[ ] Documentación actualizada
[ ] Rollback documentado
[ ] PR creado
[ ] CI verde
[ ] Revisión independiente
[ ] Validación staging cuando aplique
```

---

# 10. Formato obligatorio de entrega de Claude Code

Claude debe terminar cada tarea con:

```text
ENTREGA FINAL — <FASE>

1. Rama inicial
2. Commit inicial
3. Rama de trabajo
4. Archivos creados
5. Archivos modificados
6. Migraciones
7. Endpoints
8. Cambios de contrato
9. Tests agregados
10. Tests modificados
11. typecheck
12. npm test
13. build
14. Riesgos
15. Seguridad multi-tenant
16. Rollback
17. Commit hash
18. Push confirmado
19. Qué debe validar Codex
20. Qué debe validar Hermes
21. Qué NO se activó
22. Siguiente entrega recomendada
```

---

# 11. Prioridad inmediata

La siguiente fase obligatoria es:

```text
PR-1A — Cerrar MT-01
```

No implementar todavía:

* RouterOS live;
* Worker live;
* notificaciones reales;
* automatización real;
* nuevos módulos;
* rediseño completo;
* migración a Dokploy;
* CFDI real;
* suspensión automática.

---

# 12. Primera instrucción para Claude Code

Al leer este archivo, Claude Code debe:

1. Detener cualquier desarrollo no relacionado.
2. Confirmar estado del repo.
3. Localizar el código exacto de MT-01.
4. Localizar tests actuales.
5. Crear un plan pequeño para PR-1A.
6. No modificar nada antes de presentar el análisis.
7. Esperar autorización.
8. Tras autorización, implementar exclusivamente PR-1A.
9. Ejecutar tests completos.
10. Preparar entrega y validación.

---

# 13. Criterio para declarar NugaCore listo para producción

NugaCore solo podrá declararse `PRODUCTION_READY` cuando:

* MT-01 a MT-06 estén cerrados;
* no exista fallback tenant default;
* todos los dominios críticos persistan;
* backups automáticos existan;
* restore haya sido probado;
* CI sea obligatoria;
* staging y producción estén separados;
* observabilidad esté activa;
* datos reales estén conciliados;
* operación paralela haya terminado;
* seguridad haya sido revisada;
* pagos hayan sido probados;
* RouterOS haya pasado laboratorio y piloto;
* runbooks estén terminados;
* rollback haya sido probado;
* propietario haya autorizado el go-live.

---

# 14. Regla final

No optimizar por velocidad de entrega.

Optimizar por:

```text
seguridad
integridad
recuperación
auditabilidad
control
estabilidad
```

NugaCore ya tiene suficiente funcionalidad.

El trabajo pendiente es convertirlo en una plataforma segura y operable.

Desarrollar poco a poco.

Validar cada paso.

No activar producción antes de superar todos los gates.
