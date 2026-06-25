# NugaCore — Build Artifact Policy (ARCH-1.1)

> Fecha: 2026-06-24
> Alcance: política sobre el directorio de build `dist/`. No cambia
> funcionalidad, backend lógico, frontend lógico, RouterOS ni Worker Live.

## Decisión

**`dist/` NO se versiona.** El despliegue construye los artefactos desde el
código fuente en cada deploy. `dist/` permanece en `.gitignore` y fuera del
control de versiones.

## Evidencia que sustenta la decisión

1. **`.gitignore`** ya incluye `dist/` (junto a `node_modules/`, `build/`,
   `coverage/`). Verificado: `git check-ignore dist/server.cjs` → coincide.
2. **`dist/` nunca estuvo trackeado.** `git ls-files dist/` → 0 archivos;
   `git log --all -- 'dist/*'` → sin historial. Por tanto **no se requiere**
   `git rm -r --cached dist` (no hay nada que destrackear).
3. **El despliegue construye desde fuente (multistage Docker):**
   - `Dockerfile` Stage 1 (`build`): `npm ci` + `npm run build`
     (`vite build` para el frontend + `esbuild server.ts` → `dist/server.cjs`).
   - Stage 2 (`runtime`): copia `--from=build /app/dist ./dist` e instala solo
     dependencias de producción (`npm ci --omit=dev`).
   - `docker-compose.prod.yml`: `build: { context: ., dockerfile: Dockerfile }`.
4. **Coolify usa el `Dockerfile` del repo** como Build Pack y construye en cada
   deploy (ver `docs/DEPLOYMENT.md` §5: "Build Pack: Dockerfile"; "Coolify
   construye y publica"). El gate de auto-deploy en `main` es CI verde
   (`.github/workflows/ci.yml`), que incluye `typecheck` + tests + `build`.

## Implicaciones

- El árbol de trabajo puede contener un `dist/` local (lo generan `npm run dev`,
  `npm run build` y los tests). Es **local y efímero**; Git lo ignora.
- Reproducir el artefacto: `npm run build` (o `npm run clean` para borrarlo).
- Las variables `VITE_*` se incrustan en **build-time** como build args del
  Dockerfile; el resto de la configuración se inyecta en **runtime** vía
  `env_file`. Versionar `dist/` arriesgaría publicar un bundle con `VITE_*`
  obsoletas o secretos incrustados: razón adicional para no versionarlo.

## Qué NO hacer

- No commitear `dist/` ni quitarlo de `.gitignore`.
- No usar artefactos `dist/` versionados como fuente de despliegue: el deploy
  siempre reconstruye desde el código fuente del commit desplegado.

## Nota histórica

Mensajes de commit previos (PROD-8, ARCH-1) mencionaron por error que
`git add .` incluía artefactos de `dist/` "ya versionados". Es **incorrecto**:
`dist/` siempre estuvo ignorado y nunca fue trackeado. Este documento es la
referencia válida.
