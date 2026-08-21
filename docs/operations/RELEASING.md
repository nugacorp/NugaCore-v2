# Releasing NugaCore

Guía canónica para publicar una versión de NugaCore. Es un documento de release engineering, **no** una autorización para desplegar, migrar o promover nada a producción.

## Siete cosas distintas que se confunden

Casi todos los errores de release vienen de tratar estos conceptos como si fueran uno. Aquí son siete pasos separados, y sólo se avanza al siguiente cuando el anterior está verde.

| Concepto | Qué es | Qué NO es |
| --- | --- | --- |
| **Build** | Compilar el código: `vite build` + `esbuild`. Produce `dist/`. | No produce nada publicable por sí mismo. |
| **Imagen / artefacto** | La imagen OCI construida desde el `Dockerfile`. Se identifica sin ambigüedad por su **digest** (`sha256:…`). | No es el tag Git ni el release. |
| **Tag Git** | Un puntero inmutable a un commit: `v2.0.0-rc.1`. Es lo que dispara el pipeline. | No contiene la imagen ni la publica. |
| **GitHub Release** | La entrada visible del repositorio, con notas y `release-manifest.json`. Es la señal de "esto es desplegable". | No despliega nada. |
| **GitHub Package** | La imagen alojada en GHCR: `ghcr.io/nugacorp/nugacore-v2`. | No es un paquete npm. |
| **Despliegue** | Ejecutar un digest concreto en un ambiente. Acción humana y separada. | No ocurre al crear el release. |
| **Migración** | Aplicar DDL a una base de datos. Acción humana, separada y no reversible por el contenedor. | No viaja con la imagen. |

## NugaCore no es un paquete npm

`package.json` declara `"private": true`. NugaCore **no se publica en el registro de npm** y no debe hacerlo: es una aplicación, no una librería.

El único artefacto distribuible es la **imagen OCI en GHCR**:

```text
ghcr.io/nugacorp/nugacore-v2
```

### El package todavía no existe

GHCR crea el package en la **primera publicación real**. Ahora mismo no existe, y esta fase no lo crea: sólo deja el pipeline listo.

Tras el primer release, un administrador debe comprobar **antes de desplegar**:

- **Visibilidad** del package (privado por defecto; hacerlo público es una decisión explícita).
- **Vinculación al repositorio**, para que herede permisos y aparezca en la pestaña Packages.
- **Permisos heredados**, verificando quién puede leer (`pull`) y quién puede escribir.

## Contrato de tags

| Forma | Ejemplo | `prerelease` | Etiqueta de imagen |
| --- | --- | --- | --- |
| Estable | `v2.0.0` | `false` | `2.0.0` |
| Release candidate | `v2.0.0-rc.1` | `true` | `2.0.0-rc.1` |

Reglas:

- `N` en `rc.N` empieza en **1**. `rc.0` no existe.
- Sin ceros iniciales (`v02.0.0`, `rc.01` se rechazan).
- Sin metadatos `+build`, sin espacios, sin `latest`, `beta` ni `alpha`.
- `package.json` y la versión raíz de `package-lock.json` deben coincidir **exactamente** con el tag sin la `v`.

Comprobación local antes de etiquetar:

```bash
npm run validate:release-tag v2.0.0-rc.1
```

Sale con código distinto de cero ante cualquier incumplimiento, y el workflow lo ejecuta otra vez antes de publicar nada.

## Procedimiento

### 1. PR de versión

Un PR **separado**, que sólo actualiza la versión:

```bash
npm version 2.0.0-rc.1 --no-git-tag-version
```

Debe tocar `package.json` y `package-lock.json`, y nada más. Mezclar el bump con cambios funcionales hace imposible saber qué introdujo un release.

### 2. Merge a `main`

Merge commit, como el resto del repositorio.

### 3. Esperar CI y Production Gates sobre el merge SHA

Ambos workflows deben terminar en `success` **sobre el commit de merge exacto**. El workflow de release lo vuelve a comprobar y falla cerrado si faltan, están pendientes, corresponden a otro SHA o fallaron.

### 4. Tag anotado sobre ese SHA

```bash
git switch main
git pull --ff-only origin main
git tag -a v2.0.0-rc.1 -m "NugaCore v2.0.0-rc.1" <MERGE_SHA>
```

Anotado, no ligero: conserva autor, fecha y mensaje.

### 5. Empujar **sólo** el tag

```bash
git push origin v2.0.0-rc.1
```

Nunca `git push --tags`: empujaría cualquier tag local suelto.

### 6. Esperar el workflow de release

Ejecuta, en este orden y deteniéndose ante el primer fallo:

1. Confirma que el commit etiquetado es ancestro de `main`.
2. Valida el contrato tag ↔ versión.
3. Exige `CI` y `Production Gates` en `success` sobre ese SHA.
4. Rechaza si ya existe un release para el tag.
5. Construye y publica multi-arquitectura (`linux/amd64,linux/arm64`) con provenance `mode=max` y SBOM.
6. Adjunta una attestation al nombre completo de la imagen y a su digest.
7. **Descarga la imagen por digest** y repite el smoke de `/api/health/live` y `/runtime-config.js`.
8. Sólo entonces crea el GitHub Release, con notas generadas y `release-manifest.json`.

El release es el **último** paso a propósito. Si el smoke por digest falla, queda una imagen publicada sin release: ese es el fallo seguro, porque el procedimiento de despliegue parte del release y nadie desplegará una imagen que no aparece en ninguno.

### 7. Verificar

- El GitHub Release existe, con `-rc.N` marcado como prerelease.
- `release-manifest.json` trae tag, versión, `sourceSha`, imagen, digest y plataformas.
- El digest publicado coincide con el del manifiesto.
- La attestation de procedencia y el SBOM están presentes.

## Reglas que no se negocian

### Los tags no se mueven ni se reutilizan

Un tag publicado apunta a un release y a una imagen. Moverlo deja artefactos que dicen proceder de un árbol que ya no existe.

**Un RC defectuoso se sustituye con `rc.N+1`**, nunca reescribiendo el anterior. El workflow rechaza un tag cuyo release ya exista.

### Desplegar por digest, nunca por etiqueta móvil

```bash
# Correcto: reproducible
ghcr.io/nugacorp/nugacore-v2@sha256:<digest>

# Incorrecto: no se puede saber qué está corriendo
ghcr.io/nugacorp/nugacore-v2:latest
```

El pipeline **no publica** `latest`, `edge`, `main` ni ninguna otra etiqueta mutable. Las dos etiquetas que publica —`<versión>` y `sha-<SHA completo>`— son inmutables por convención, pero la referencia de despliegue debe ser el digest.

### Rollback de aplicación = digest anterior

Volver atrás es desplegar el digest anterior. Es inmediato y no requiere reconstruir nada, precisamente porque la imagen no lleva configuración de ambiente incrustada.

### Las migraciones no vuelven atrás con el contenedor

Revertir el contenedor **no** revierte el esquema. Una migración aplicada sigue aplicada.

Por eso, toda migración destinada a promoverse debe ser **compatible hacia atrás** —aditiva, tolerante a la versión anterior del binario— o venir con un plan operativo explícito de rollback: orden de despliegue, ventana, verificación y procedimiento de reversión manual.

La secuencia segura habitual es: aplicar la migración aditiva, verificarla, y sólo entonces desplegar el binario que la usa.

## build-once / deploy-many

La imagen **no** se construye por ambiente.

Antes, `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` entraban como build args y Vite las incrustaba en el bundle. Una imagen construida para staging no podía promoverse intacta a producción, así que había que reconstruir por ambiente — y entonces lo que corría en producción nunca era exactamente lo que se había probado.

Ahora el servidor entrega esa configuración pública en runtime:

```text
GET /runtime-config.js
Cache-Control: no-store

window.__NUGACORE_RUNTIME_CONFIG__={"SUPABASE_URL":"…","SUPABASE_ANON_KEY":"…"};
```

`index.html` lo carga como script clásico antes del bundle, así que el cliente siempre encuentra el global ya definido. `src/lib/supabase.ts` prefiere esa configuración y conserva `VITE_*` como respaldo para desarrollo local.

Al ejecutar el contenedor:

```bash
docker run -d \
  -e SUPABASE_URL="https://<proyecto>.supabase.co" \
  -e SUPABASE_ANON_KEY="<anon key>" \
  ghcr.io/nugacorp/nugacore-v2@sha256:<digest>
```

**Sólo esos dos valores llegan al navegador.** El endpoint usa una allowlist explícita: nunca recorre `process.env`, así que añadir una variable nueva al despliegue no puede filtrarla. La service-role key, la secret key, `DATABASE_URL`, las claves MikroTik y los secretos de webhook no tienen ninguna ruta hasta ahí, y hay una prueba que lo verifica inyectando un marcador falso y comprobando que no aparece.

## Estado de las versiones

### `v2.0.0-rc.1` — primer candidato previsto

Todavía **no creado**. Esta fase construye el pipeline; no publica nada.

### `v2.0.0` estable — bloqueado

No puede publicarse hasta que se cumplan todas estas condiciones:

| Requisito | Estado |
| --- | --- |
| T069 — sandbox real de proveedor de pagos | Abierto |
| T070 — laboratorio CHR para escritura RouterOS | Abierto |
| T071 — paridad del esquema en staging | Abierto |
| T072 — readiness estricto de producción | Abierto |
| T073 — evidencia de backup/restore | Abierto |
| Decisiones de alcance (dominios en memoria, tablas huérfanas, UISP) | Abiertas |
| Autorización humana explícita | Requerida |

Ver [`../reports/PROJECT_STATUS_CURRENT.md`](../reports/PROJECT_STATUS_CURRENT.md) para el detalle.

### Publicar un RC no es desplegarlo

Un release candidate publicado significa que existe un artefacto inmutable, verificado y trazable. **No** significa que esté desplegado, ni que esté aprobado para producción, ni que ningún gate live deba encenderse.

El despliegue es un paso posterior, humano y separado.

## Lo que el pipeline nunca hace

El workflow de release no despliega, no ejecuta migraciones, no se conecta a staging ni a producción, no toca Coolify y no activa ningún gate live. Su superficie está acotada a: leer el repositorio, publicar en GHCR y crear el release.

Detalles de su endurecimiento —disparo sólo por tags `v*`, permisos mínimos, actions fijadas a SHA completo, autenticación sólo con `GITHUB_TOKEN`— en [`.github/workflows/release.yml`](../../.github/workflows/release.yml).
