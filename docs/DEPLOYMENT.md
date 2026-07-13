# NugaCore — Guía de Despliegue (DEPLOYMENT)

> Cubre empaquetado, ejecución local, VPS, Coolify, staging y promoción a producción.
> La persistencia crítica se activa con flags `USE_DB_*` (ver `.env.production.example` y `docs/STAGING_FLAGS_WISP_OS.md`).
> Gates de producción: `GET /api/system/production-readiness` y `scripts/validate-production-readiness.mjs`.

---

## 1. Requisitos

- **Node.js 22** (o Docker).
- **npm** (usar `npm ci` con el `package-lock.json` versionado).
- Para producción: un **VPS** con Docker y, recomendado, **Coolify** como orquestador/reverse-proxy con TLS.

---

## 2. Matriz de variables de entorno

| Variable | Dev | Prod | Descripción |
|----------|-----|------|-------------|
| `NODE_ENV` | development | production | Modo de ejecución |
| `PORT` | 3000 | 3000 | Puerto HTTP |
| `APP_URL` | http://localhost:3000 | https://tu-dominio | URL pública |
| `LOG_LEVEL` | debug | info | `debug\|info\|warn\|error` |
| `LOG_FORMAT` | pretty | json | Formato de logs |
| `AUTH_TRUST_HEADERS` | true | **false** ⚠️ | Headers de rol del cliente (inseguro en prod) |
| `GEMINI_API_KEY` | (vacío) | secret | Copiloto IA (con fallback) |
| `SUPABASE_URL` | (vacío) | (vacío en F0) | Reservado Fase 1+ |
| `SUPABASE_ANON_KEY` | (vacío) | (vacío en F0) | Reservado Fase 1+ |
| `SUPABASE_SERVICE_ROLE_KEY` | (vacío) | (vacío en F0) ⚠️ | Poder total; solo backend |
| `DATABASE_URL` | (vacío) | (vacío en F0) | Reservado Fase 1+ |
| `VITE_SUPABASE_URL` | (vacío) | (vacío en F0) | Cliente; build-time |
| `VITE_SUPABASE_ANON_KEY` | (vacío) | (vacío en F0) | Cliente; build-time |
| `MIKROTIK_CREDENTIALS_KEY` | (vacío) | **secret** ⚠️ | Cifrado de credenciales (obligatoria en prod al usar MikroTik) |
| `USE_DB_*` (por dominio) | false | false (F0) | Feature flags store↔DB (Fase 1+) |

> Las `VITE_*` se **incrustan en build-time** (build args del Dockerfile). El resto se inyecta en **runtime**.

---

## 3. Ejecución local

### 3.1 Sin Docker
```bash
cp .env.example .env       # ajusta si hace falta
npm ci
npm run dev                # build + node dist/server.cjs  → http://localhost:3000
# o con hot-reload:
npm run dev:tsx
```

### 3.2 Calidad (igual que en CI)
```bash
npm run typecheck          # tsc --noEmit
npm test                   # pruebas de contrato API v1 (Vitest + supertest)
npm run build              # build de producción (vite + esbuild)
```

### 3.3 Con Docker (dev)
```bash
docker compose -f docker-compose.dev.yml up
# Monta el código, instala deps y corre el dev server en :3000
```

### 3.4 Con Docker (réplica de producción local)
```bash
cp .env.production.example .env   # rellena secretos
docker compose -f docker-compose.prod.yml up -d --build
curl -fsS http://localhost:3000/api/health/live
```

---

## 4. Despliegue en VPS (Docker manual)

```bash
# 1) En el VPS, clona el repo y entra
git clone <repo> nugacore && cd nugacore

# 2) Configura entorno de producción
cp .env.production.example .env
#   edita .env: NODE_ENV=production, AUTH_TRUST_HEADERS=false, MIKROTIK_CREDENTIALS_KEY=...

# 3) Construye y levanta
docker compose -f docker-compose.prod.yml up -d --build

# 4) Verifica salud
curl -fsS http://localhost:3000/api/health        # estado general
curl -fsS http://localhost:3000/api/health/ready  # readiness

# 5) Logs
docker compose -f docker-compose.prod.yml logs -f nugacore
```

> Coloca un **reverse proxy con TLS** (Caddy/Traefik/Nginx) delante del puerto 3000, fuerza HTTPS y añade HSTS. Con Coolify esto es automático (sección 5).

### Generar la clave de cifrado MikroTik
```bash
openssl rand -base64 48
```

---

## 5. Despliegue en Coolify

1. **Servidor:** instala Coolify en el VPS (trae Traefik + Let's Encrypt).
2. **Nuevo recurso → Application → desde tu repositorio Git.**
3. **Build Pack:** *Dockerfile* (Coolify usa el `Dockerfile` del repo).
4. **Puerto expuesto:** `3000`.
5. **Variables de entorno (Secrets):** carga las de la tabla §2.
   - Marca como **Build Variable** solo las `VITE_*` (se incrustan en el bundle).
   - El resto son de runtime.
   - Asegura `NODE_ENV=production` y `AUTH_TRUST_HEADERS=false`.
6. **Dominio + TLS:** asigna el dominio; Coolify emite el certificado automáticamente. Activa "Force HTTPS".
7. **Health check:** ruta `/api/health/live` (liveness) y/o `/api/health/ready`.
8. **Deploy:** Coolify construye y publica. Habilita **auto-deploy** en `main` **solo tras CI verde** (el workflow `.github/workflows/ci.yml` es el gate).
9. **Migraciones (Fase 1+):** ejecuta las migraciones SQL como paso controlado (no automático en cada deploy).

---

## 6. Rollback

### 6.1 Coolify (recomendado)
- En la aplicación → pestaña **Deployments**: cada despliegue queda registrado.
- Pulsa **Redeploy/Rollback** sobre el despliegue anterior estable. Coolify reactiva esa imagen.

### 6.2 Docker manual con tags
Versiona la imagen por commit para poder volver atrás:
```bash
# Al desplegar, etiqueta con el SHA del commit
docker build -t nugacore:$(git rev-parse --short HEAD) .
docker tag nugacore:$(git rev-parse --short HEAD) nugacore:latest

# Rollback: re-apunta latest a una versión previa y reinicia
docker tag nugacore:<sha-anterior> nugacore:latest
docker compose -f docker-compose.prod.yml up -d
```

### 6.3 Rollback por Git
```bash
git revert <sha-malo>     # crea un commit que deshace el cambio (preferido)
# o, si nadie más trabaja sobre la rama:
git checkout <sha-bueno> -- <archivos>
# luego: CI verde → redeploy
```

### 6.4 Verificación post-rollback
```bash
curl -fsS https://tu-dominio/api/health
# Comprueba que version/uptime correspondan a la versión esperada.
```

> **Fase 0 sin DB:** un rollback de código es seguro porque no hay esquema ni datos persistentes que migrar. A partir de Fase 1, todo rollback deberá considerar la compatibilidad de migraciones (ver MASTER_BACKLOG F8-5).

---

## 7. Checklist de "listo para producción" (estado Fase 0)

- [x] Imagen Docker reproducible (multistage, runtime mínimo).
- [x] Health checks (`/api/health`, `/live`, `/ready`).
- [x] CI con typecheck + pruebas de contrato + build.
- [x] Variables de entorno documentadas y separadas dev/prod.
- [x] Logs estructurables (JSON en prod).
- [ ] Persistencia real (Fase 1).
- [ ] Autenticación verificada / `AUTH_TRUST_HEADERS=false` efectivo (Fase 2).
- [ ] Backups reales de DB (Fase 7).
