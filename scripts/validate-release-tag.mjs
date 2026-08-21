#!/usr/bin/env node
// ====================================================================
// NugaCore — contrato tag ↔ versión (Release Engineering).
//
// HERMÉTICO: no consulta la red, no habla con GitHub, no toca Docker. Lee
// `package.json` y `package-lock.json` del árbol de trabajo y compara con el
// tag recibido.
//
// POR QUÉ EXISTE
//
// Un tag Git es inmutable en la práctica, aunque Git permita moverlo. Una vez
// que el release y la imagen OCI se publicaron apuntando a ese tag, moverlo
// deja artefactos huérfanos que dicen proceder de un árbol que ya no existe:
// el digest sigue siendo el de la build vieja, pero `image.revision` apunta a
// otro commit. Por eso el contrato se valida ANTES de publicar nada.
//
// POLÍTICA
//
//   Estable            vMAJOR.MINOR.PATCH          → prerelease = false
//   Release candidate  vMAJOR.MINOR.PATCH-rc.N     → prerelease = true, N ≥ 1
//
// Se rechaza todo lo demás, incluidos `latest`, `beta`, `alpha`, `rc.0`, los
// ceros iniciales, los metadatos `+build` y cualquier whitespace. `rc.0` no
// existe: la numeración de candidatos empieza en 1, y un RC defectuoso se
// sustituye por `rc.N+1`, nunca reescribiendo el anterior.
//
// SALIDA
//
// Determinista y consumible desde GitHub Actions: escribe `version`,
// `prerelease` e `image_tag` en `$GITHUB_OUTPUT` cuando existe.
// ====================================================================

import { readFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * `(0|[1-9]\d*)` en cada posición prohíbe los ceros iniciales sin prohibir el
 * cero legítimo (`v0.1.0`). El grupo rc exige `[1-9]\d*`, así que `rc.0` y
 * `rc.01` quedan fuera. El anclaje `^…$` descarta whitespace y `+build`.
 */
export const RELEASE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

/**
 * @typedef {Object} ReleaseTagResult
 * @property {boolean} ok
 * @property {string[]} errors
 * @property {string|null} version     Versión sin la `v`.
 * @property {boolean} prerelease
 * @property {string|null} imageTag    Etiqueta OCI (== versión, nunca con `v`).
 */

/**
 * Valida el contrato. Recibe las versiones como argumentos para poder
 * probarse sin tocar el disco.
 *
 * @param {{tag?: string, packageVersion?: string, lockVersion?: string}} input
 * @returns {ReleaseTagResult}
 */
export function validateReleaseTag(input = {}) {
  const errors = [];
  const rawTag = input.tag;

  if (typeof rawTag !== 'string' || rawTag.length === 0) {
    return {
      ok: false,
      errors: ['Falta el tag. Uso: validate-release-tag <vX.Y.Z|vX.Y.Z-rc.N>.'],
      version: null,
      prerelease: false,
      imageTag: null,
    };
  }

  const match = RELEASE_TAG_PATTERN.exec(rawTag);
  if (!match) {
    return {
      ok: false,
      errors: [
        `Tag fuera de política: ${JSON.stringify(rawTag)}. Se admite `
        + 'vMAJOR.MINOR.PATCH o vMAJOR.MINOR.PATCH-rc.N (N ≥ 1, sin ceros '
        + 'iniciales, sin metadatos +build, sin espacios).',
      ],
      version: null,
      prerelease: false,
      imageTag: null,
    };
  }

  const version = rawTag.slice(1);
  const prerelease = match[4] !== undefined;

  // La comparación es estricta: un ' 2.0.0' con espacio no es la misma versión
  // aunque lo parezca, y un manifiesto así rompería la trazabilidad.
  for (const [label, value] of [
    ['package.json', input.packageVersion],
    ['package-lock.json', input.lockVersion],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`Falta la versión de ${label}.`);
      continue;
    }
    if (value !== version) {
      errors.push(
        `La versión de ${label} (${JSON.stringify(value)}) no coincide con el tag `
        + `${rawTag} (esperado ${JSON.stringify(version)}).`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.sort(),
    version,
    prerelease,
    imageTag: version,
  };
}

/** Lee la versión declarada en los manifiestos del repositorio. */
export function readRepositoryVersions(root = REPO_ROOT) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  return { packageVersion: pkg.version, lockVersion: lock.version };
}

/** Ejecución CLI. Devuelve el código de salida (0 = OK). */
export function runValidateReleaseTagCli({
  tag = process.argv[2],
  root = REPO_ROOT,
  log = console,
  githubOutput = process.env.GITHUB_OUTPUT,
} = {}) {
  let versions;
  try {
    versions = readRepositoryVersions(root);
  } catch (error) {
    log.error(`No se pudieron leer los manifiestos de versión: ${error.message}`);
    return 1;
  }

  const result = validateReleaseTag({ tag, ...versions });

  log.log('=== NugaCore · contrato tag ↔ versión ===');
  log.log(`tag: ${tag ?? '(ausente)'}`);
  log.log(`package.json: ${versions.packageVersion}`);
  log.log(`package-lock.json: ${versions.lockVersion}`);

  if (!result.ok) {
    log.error(`resultado: FALLO — ${result.errors.length} incumplimiento(s):`);
    for (const error of result.errors) log.error(`  - ${error}`);
    return 1;
  }

  log.log(`version: ${result.version}`);
  log.log(`prerelease: ${result.prerelease}`);
  log.log(`image_tag: ${result.imageTag}`);
  log.log('resultado: OK');

  if (githubOutput) {
    appendFileSync(
      githubOutput,
      `version=${result.version}\nprerelease=${result.prerelease}\nimage_tag=${result.imageTag}\n`,
    );
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runValidateReleaseTagCli());
}
