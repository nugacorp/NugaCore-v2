# NugaCore — Estrategia de Desarrollo (DEVELOPMENT_STRATEGY)

> Última actualización: 2026-06-01
> Cómo continuar el desarrollo sin romper lo construido. Responde 8 preguntas clave.

---

## 1. Qué se debe hacer primero

**Orden no negociable** (el "porqué" en [MASTER_BACKLOG.md](MASTER_BACKLOG.md)):

1. **Red de seguridad antes que migración.** Sin pruebas de contrato de la API v1 y sin CI, mover datos del mock a la DB romperá el frontend en silencio. → **Fase 0**.
2. **Capa de persistencia con un dominio piloto (Clientes).** Validar el patrón repository/service/mappers con el contrato intacto antes de tocar el resto. → **Fase 1**.
3. **Autenticación real.** Es el agujero crítico (S-01). Debe cerrarse antes de exponer el sistema. → **Fase 2**.
4. **Migrar el resto de dominios** en orden de riesgo (Planes → Facturación → Suspensión → Red → FTTH → Inventario → Soporte → derivados). → **Fase 3**.
5. **Integraciones reales** (MikroTik, automatización, pagos/CFDI) → **Fases 4–6**.
6. **Hardening + deploy** → **Fases 7–8**.

> Regla de oro: **una cosa a la vez, detrás de un feature flag, con tests que prueben que el contrato no cambió.**

---

## 2. Qué NO debe tocarse

- **El frontend visual.** No se altera markup, clases Tailwind, colores, estructura de componentes ni IDs del DOM. Cualquier refactor de UI es solo *interno* (extraer subcomponentes/hooks) y debe verse **idéntico**.
- **El contrato de API v1.** Las rutas y formas de respuesta que `App.tsx` consume hoy (ver [API_ANALYSIS.md](API_ANALYSIS.md) §6) son intocables salvo cambio aditivo o adaptación del frontend en el mismo PR.
- **Los tipos de `src/types.ts`** sin autorización: son la fuente de verdad del contrato (ver [DATA_CONTRACT.md](DATA_CONTRACT.md)).
- **Las decisiones ratificadas:** IDs TEXT/slug para negocio, UUID para IAM, enums en inglés, acceso vía backend con service-role.

---

## 3. Cómo evitar romper el frontend

1. **Suite de contrato (golden tests):** capturar la respuesta actual (mock) de cada endpoint núcleo y verificar que la versión con DB devuelve la **misma forma** (snapshots). Es la barrera principal.
2. **Migración detrás de feature flags por dominio** (`USE_DB_CLIENTS`, …): permite volver al mock al instante si algo falla.
3. **Cambios aditivos:** nuevos campos opcionales/nuevos endpoints; nunca renombrar/quitar lo que el frontend ya usa.
4. **Verificación visual módulo por módulo:** tras cada migración, abrir el módulo y confirmar paridad (usar la skill `/verify` o `/run`).
5. **Paginación con compatibilidad:** si se añade, mantener el comportamiento "trae todo" por defecto hasta adaptar el frontend.
6. **Mappers estrictos:** la traducción `snake_case`↔`camelCase` ocurre **solo** en el repository; los valores de enum **no se traducen** (la DB ya guarda inglés).

---

## 4. Cómo migrar del backend mock a backend real

### Patrón por dominio (repetible)
```
1. Definir mappers DB-row ↔ tipo de shared/types
2. Implementar repository.ts (CRUD + queries) usando supabaseAdmin
3. Extraer reglas de negocio de routes.ts → service.ts
4. routes.ts pasa a llamar service (no toca store)
5. Feature flag USE_DB_<DOMINIO>:  ON → repository · OFF → store
6. Pruebas de integración contra DB de staging
7. Golden test confirma contrato idéntico
8. Activar flag en staging → validar → activar en prod
9. Cuando todos los dominios estén en DB → retirar store.ts
```

### Consideraciones especiales
- **Generación de IDs:** sustituir `getUnique*Id()` (race conditions) por secuencias/transacciones. Preservar el formato slug (`c-1`, `fac-101`) si el frontend depende de él.
- **Side-effects en GET:** mover `syncInvoiceStatus` a un write o columna calculada; el GET debe ser de solo lectura.
- **Cascadas:** confiar en las FKs `ON DELETE CASCADE` del esquema en vez de los `filter` manuales del store.
- **Datos semilla:** los catálogos (roles, permisos, planes, singletons) ya están en `rls_and_seeds`; los datos demo (clientes, facturas) **no** se siembran — se cargan desde el flujo real o un seed de staging aparte.

---

## 5. Cómo integrar MikroTik

> La base ya existe (clasificación read/write, confirmación, auditoría, cifrado). Falta la ejecución real.

### Estrategia incremental (mínimo riesgo)
1. **Worker desacoplado** del proceso web (un servicio/contenedor aparte) que habla RouterOS API (puerto 8728, o 8729 con TLS — preferible).
2. **Solo lectura primero:** health real, `interface/queue/ppp print`. Validar contra un router de laboratorio.
3. **Escritura confirmada después:** mantener la barrera `confirmWrite=true` y el bloqueo de destructivos; toda escritura se audita en `mikrotik_command_audit`.
4. **Cola de comandos** con reintentos/timeouts; la API encola, el worker ejecuta. Aísla fallos de red.
5. **Suspensión real:** la reactivación/suspensión aplica queues/PPPoE/address-list en el router (hoy solo escribe en `MIKROTIK_LOGS`).
6. **Credenciales:** descifrar solo en el worker, en memoria, justo antes de conectar; nunca exponer por API.
7. **Modo simulado conmutable:** conservar el simulador actual como modo de demo/test (flag), claramente distinguible del modo real.

### Riesgos a controlar
- Comandos de escritura son destructivos por naturaleza → política de confirmación + dry-run + auditoría obligatoria.
- Latencia/timeout de routers remotos → worker asíncrono, nunca bloquear el request web.
- Versiones RouterOS v6 vs v7 → abstraer diferencias en el conector.

---

## 6. Cómo desplegar en VPS

### Topología recomendada
```
Internet ──► VPS
              ├─ Coolify (orquestador + reverse proxy/Traefik + TLS)
              │    ├─ Contenedor: NugaCore API+SPA (1 proceso)
              │    └─ Contenedor: Worker MikroTik (cuando exista)
              └─ Supabase (gestionado en la nube, recomendado) o self-hosted
```
- **Supabase gestionado** simplifica auth, backups y RLS; self-hosted solo si hay requisito de soberanía de datos.
- **Variables/secretos** inyectados por Coolify (no `.env` en disco): `SUPABASE_*`, `MIKROTIK_CREDENTIALS_KEY`, `GEMINI_API_KEY`, `NODE_ENV=production`, `AUTH_TRUST_HEADERS=false`.
- **TLS + HSTS** terminados en el proxy; redirigir HTTP→HTTPS.
- **Healthcheck** `/api/auth/health` para readiness/liveness.

---

## 7. Cómo usar Coolify

1. **Conectar el repositorio** Git a Coolify (deploy por push o por webhook desde CI).
2. **Tipo de recurso:** aplicación basada en Dockerfile (preferido) o buildpack Nixpacks.
3. **Build:** Coolify ejecuta el `Dockerfile` (Fase 0 F0-6); resultado `dist/server.cjs` + estáticos.
4. **Runtime:** comando `node dist/server.cjs`, puerto 3000 expuesto al proxy interno.
5. **Variables de entorno:** definirlas en la UI de Coolify como *secrets*; marcar como *build-time* solo las `VITE_*` (se incrustan en el bundle).
6. **Dominio + TLS:** asignar dominio; Coolify gestiona Let's Encrypt automáticamente.
7. **Despliegue continuo:** habilitar auto-deploy en la rama de producción **solo tras CI verde** (gate de calidad de Fase 0).
8. **Rollback:** Coolify conserva despliegues previos; documentar el procedimiento en el runbook.
9. **Migraciones:** ejecutar las migraciones SQL como paso previo controlado (job/manual), no automáticamente en cada deploy, para evitar cambios destructivos no revisados.

---

## 8. Cómo usar Docker

### Dockerfile (multistage, propuesta)
```dockerfile
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# las VITE_* deben estar presentes en build (se incrustan en el bundle)
RUN npm run build              # vite build + esbuild server → dist/

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
```

### Buenas prácticas
- **`.dockerignore`:** `node_modules`, `.git`, `docs`, `*.log`, `latest`, `.env`.
- **Imagen pequeña:** Alpine + `--omit=dev` en runtime.
- **No copiar secretos** a la imagen; inyectarlos en runtime (Coolify).
- **Usuario no root** en el contenedor (añadir `USER node`).
- **Worker MikroTik** como imagen/servicio separado cuando exista (Fase 4).
- **Healthcheck** en el `Dockerfile`/compose apuntando a `/api/auth/health`.

### docker-compose (dev, opcional)
- Servicio `app` (build local, montaje de código, `DISABLE_HMR` según necesidad).
- Servicio opcional de Supabase local para integración, o apuntar a un proyecto de staging.

---

## 9. Principios operativos (resumen)

| Principio | Implicación práctica |
|-----------|----------------------|
| Visual freeze | UI idéntica; refactor solo interno |
| Contrato v1 estable | Cambios aditivos; golden tests |
| Migración por dominios | Feature flags; piloto Clientes |
| Seguridad temprana | Auth real antes de exponer |
| Reversibilidad | Flags + rollback + backups probados |
| Calidad como gate | CI verde obligatorio para merge/deploy |
| Integraciones aisladas | Worker/adaptadores desacoplados |
