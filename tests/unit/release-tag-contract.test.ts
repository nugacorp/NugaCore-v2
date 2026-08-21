import { describe, expect, it } from 'vitest';

import {
  RELEASE_TAG_PATTERN,
  validateReleaseTag,
} from '../../scripts/validate-release-tag.mjs';

// ====================================================================
// Contrato tag ↔ versión.
//
// Un tag es inmutable en la práctica: una vez publicado el release y la
// imagen, mover el tag deja artefactos huérfanos apuntando a un árbol que ya
// no existe. Por eso el contrato se valida ANTES de publicar nada, y por eso
// `package.json`, `package-lock.json` y el tag deben coincidir exactamente.
//
// Hermético: recibe las versiones como argumento, no lee la red ni el disco.
// ====================================================================

const check = (tag: string, pkg = '2.0.0', lock = '2.0.0') =>
  validateReleaseTag({ tag, packageVersion: pkg, lockVersion: lock });

describe('tags aceptados', () => {
  it('acepta un estable vMAJOR.MINOR.PATCH', () => {
    const result = check('v2.0.0');

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.version).toBe('2.0.0');
    expect(result.prerelease).toBe(false);
    expect(result.imageTag).toBe('2.0.0');
  });

  it('acepta un release candidate vMAJOR.MINOR.PATCH-rc.N', () => {
    const result = check('v2.0.0-rc.1', '2.0.0-rc.1', '2.0.0-rc.1');

    expect(result.ok).toBe(true);
    expect(result.version).toBe('2.0.0-rc.1');
    expect(result.prerelease).toBe(true);
    expect(result.imageTag).toBe('2.0.0-rc.1');
  });

  it('acepta rc.N con N > 9', () => {
    const result = check('v2.0.0-rc.12', '2.0.0-rc.12', '2.0.0-rc.12');

    expect(result.ok).toBe(true);
    expect(result.prerelease).toBe(true);
  });

  it('acepta ceros legítimos en las posiciones semver', () => {
    expect(check('v0.1.0', '0.1.0', '0.1.0').ok).toBe(true);
    expect(check('v10.20.30', '10.20.30', '10.20.30').ok).toBe(true);
  });
});

describe('tags rechazados', () => {
  const rejected: Array<[string, string]> = [
    ['sin la v inicial', '2.0.0'],
    ['versión incompleta (major.minor)', 'v2.0'],
    ['versión incompleta (solo major)', 'v2'],
    ['rc.0 no existe: la numeración empieza en 1', 'v2.0.0-rc.0'],
    ['cero inicial en major', 'v02.0.0'],
    ['cero inicial en minor', 'v2.01.0'],
    ['cero inicial en patch', 'v2.0.01'],
    ['cero inicial en el número de rc', 'v2.0.0-rc.01'],
    ['prerelease beta fuera de política', 'v2.0.0-beta.1'],
    ['prerelease alpha fuera de política', 'v2.0.0-alpha.1'],
    ['prerelease rc sin número', 'v2.0.0-rc'],
    ['metadatos de build', 'v2.0.0+build.5'],
    ['metadatos de build sobre un rc', 'v2.0.0-rc.1+build.5'],
    ['etiqueta mutable latest', 'latest'],
    ['etiqueta mutable v-latest', 'v-latest'],
    ['whitespace por delante', ' v2.0.0'],
    ['whitespace por detrás', 'v2.0.0 '],
    ['whitespace interior', 'v2.0. 0'],
    ['mayúscula en la v', 'V2.0.0'],
    ['sufijo arbitrario', 'v2.0.0-final'],
  ];

  for (const [label, tag] of rejected) {
    it(`rechaza ${label}: ${JSON.stringify(tag)}`, () => {
      const result = validateReleaseTag({
        tag,
        packageVersion: tag.replace(/^v/, ''),
        lockVersion: tag.replace(/^v/, ''),
      });

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }

  it('rechaza un tag ausente', () => {
    expect(validateReleaseTag({ tag: '', packageVersion: '2.0.0', lockVersion: '2.0.0' }).ok).toBe(false);
    expect(validateReleaseTag({ packageVersion: '2.0.0', lockVersion: '2.0.0' }).ok).toBe(false);
  });
});

describe('coherencia con package.json y package-lock.json', () => {
  it('rechaza un mismatch con package.json', () => {
    const result = check('v2.1.0', '2.0.0', '2.1.0');

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/package\.json/);
    expect(result.errors.join('\n')).toContain('2.0.0');
  });

  it('rechaza un mismatch con package-lock.json', () => {
    const result = check('v2.1.0', '2.1.0', '2.0.0');

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/package-lock\.json/);
  });

  it('rechaza cuando ambos difieren y nombra los dos', () => {
    const result = check('v3.0.0', '2.0.0', '1.0.0');

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rechaza versiones ausentes en los manifiestos', () => {
    expect(check('v2.0.0', '', '2.0.0').ok).toBe(false);
    expect(check('v2.0.0', '2.0.0', '').ok).toBe(false);
  });

  it('no acepta una coincidencia "casi igual" con whitespace', () => {
    expect(check('v2.0.0', ' 2.0.0', '2.0.0').ok).toBe(false);
  });
});

describe('forma del contrato', () => {
  it('el patrón acepta exactamente la política y nada más', () => {
    expect(RELEASE_TAG_PATTERN.test('v2.0.0')).toBe(true);
    expect(RELEASE_TAG_PATTERN.test('v2.0.0-rc.1')).toBe(true);
    expect(RELEASE_TAG_PATTERN.test('v2.0.0-rc.0')).toBe(false);
    expect(RELEASE_TAG_PATTERN.test('v2.0.0+build')).toBe(false);
  });

  it('la salida es determinista para la misma entrada', () => {
    expect(check('v2.0.0')).toEqual(check('v2.0.0'));
    expect(check('v9.9.9', '1.0.0')).toEqual(check('v9.9.9', '1.0.0'));
  });

  it('nunca marca prerelease un estable', () => {
    expect(check('v2.0.0').prerelease).toBe(false);
  });

  it('el tag de imagen nunca conserva la v', () => {
    expect(check('v2.0.0').imageTag).not.toMatch(/^v/);
    expect(check('v2.0.0-rc.1', '2.0.0-rc.1', '2.0.0-rc.1').imageTag).not.toMatch(/^v/);
  });
});

describe('el repositorio actual', () => {
  it('todavía declara 2.0.0 y no prepara un rc en este PR', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { version: string };

    expect(pkg.version).toBe('2.0.0');
    expect(lock.version).toBe('2.0.0');
  });
});
