# ====================================================================
# NugaCore — Dockerfile de producción (multistage)
# Imagen final mínima: solo dependencias de runtime + dist/
#
# Requiere: server.ts importa Vite de forma perezosa (dynamic import)
#           para que la imagen de runtime pueda usar --omit=dev.
# ====================================================================

# ---- Stage 1: build ----
FROM node:22-alpine AS build
WORKDIR /app

# Instalar TODAS las dependencias (incluye dev: vite, esbuild) para el build
COPY package.json package-lock.json ./
RUN npm ci

# Copiar el código y construir
COPY . .

# Las variables VITE_* se incrustan en el bundle del frontend en build-time.
# Si se usa Supabase en el cliente, deben pasarse como build args (ver abajo).
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

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

# Ejecutar como usuario no-root (la imagen node trae el usuario "node")
USER node

EXPOSE 3000

# Healthcheck del contenedor (usa el endpoint de liveness de la API)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
