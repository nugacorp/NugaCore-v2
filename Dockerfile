# ====================================================================
# NugaCore — imagen de producción (multistage).
#
# BUILD-ONCE / DEPLOY-MANY
#
# Esta imagen NO se construye para un ambiente concreto. La configuración
# pública de Supabase (URL y anon key) ya no se incrusta en el bundle: el
# servidor la entrega en runtime desde `/runtime-config.js`, así que el MISMO
# digest validado en staging puede promoverse a producción cambiando sólo
# variables del contenedor.
#
# Antes, `VITE_SUPABASE_*` entraba por build args y quedaba dentro del
# JavaScript. Eso obligaba a reconstruir por ambiente y, con ello, lo que se
# desplegaba en producción nunca era exactamente lo que se había probado.
#
# NUNCA pasar secretos por build args: quedan en el historial de capas y en la
# metadata de la imagen. La service-role key, `MIKROTIK_CREDENTIALS_KEY` y los
# secretos de webhook se inyectan al EJECUTAR el contenedor.
#
# Requiere: server.ts importa Vite de forma perezosa (dynamic import) para que
# la imagen de runtime pueda usar --omit=dev.
# ====================================================================

# ---- Stage 1: build ----
FROM node:22-alpine AS build
WORKDIR /app

# Instalar TODAS las dependencias (incluye dev: vite, esbuild) para el build
COPY package.json package-lock.json ./
RUN npm ci

# Copiar el código y construir
COPY . .

# Único flag que sigue siendo build-time: es una bandera de producto del
# frontend (`__WIREGUARD_MULTITENANT__` en vite.config.ts), no configuración
# por ambiente. No lleva secretos.
ARG WIREGUARD_MULTITENANT="false"
ENV WIREGUARD_MULTITENANT=$WIREGUARD_MULTITENANT

# vite build (dist/ frontend) + esbuild (dist/server.cjs)
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Solo dependencias de producción (server.cjs las requiere como externas)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar el artefacto construido (server.cjs + assets del frontend)
COPY --from=build /app/dist ./dist

# ── Metadata OCI ──────────────────────────────────────────────────────
# Los valores los controla el workflow de release; nunca se derivan de una
# llamada arbitraria dentro del build. IMAGE_CREATED usa la fecha del COMMIT,
# no `date`, para que un rerun del mismo tag produzca la misma metadata en vez
# de una marca nueva por cada intento.
ARG IMAGE_SOURCE="https://github.com/nugacorp/NugaCore-v2"
ARG IMAGE_REVISION="unknown"
ARG IMAGE_VERSION="0.0.0-dev"
ARG IMAGE_CREATED="1970-01-01T00:00:00Z"

LABEL org.opencontainers.image.title="NugaCore" \
      org.opencontainers.image.description="Plataforma SaaS multi-tenant de operación para WISP/ISP" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.created="${IMAGE_CREATED}"

# Ejecutar como usuario no-root (la imagen node trae el usuario "node")
USER node

EXPOSE 3000

# Healthcheck del contenedor (usa el endpoint de liveness de la API)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
