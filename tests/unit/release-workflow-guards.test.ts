import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Guardas del workflow PRIVILEGIADO de release.
//
// `release.yml` es el único workflow que escribe fuera del repositorio:
// publica una imagen en GHCR y crea un GitHub Release. Estas pruebas fijan
// las propiedades que no deben poder relajarse sin que alguien lo note.
//
// Se comprueba el texto del workflow a propósito: no hay forma de ejecutarlo
// aquí (sólo se dispara con un tag `v*`, y esta fase no crea tags).
// ====================================================================

const release = readFileSync('.github/workflows/release.yml', 'utf8');
const gates = readFileSync('.github/workflows/production-gates.yml', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

const IMAGE = 'ghcr.io/nugacorp/nugacore-v2';

/**
 * El workflow sin líneas de comentario. Su cabecera explica precisamente qué
 * NO hace (`pull_request_target`, Coolify, migraciones...), así que una guarda
 * que buscara esas palabras en el texto completo se dispararía contra la
 * documentación en vez de contra el comportamiento.
 */
const releaseCode = release
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('superficie de disparo', () => {
  it('se dispara sólo con tags v*', () => {
    expect(release).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*- 'v\*'/);
  });

  it('no se dispara por pull_request_target', () => {
    // Ejecutaría código de un fork con los permisos del repositorio base.
    expect(releaseCode).not.toContain('pull_request_target');
  });

  it('no se dispara por pull_request ni por push a ramas', () => {
    expect(release).not.toMatch(/^\s*pull_request:/m);
    expect(release).not.toMatch(/push:\s*\n\s*branches:/);
  });

  it('no cancela ejecuciones en curso', () => {
    expect(release).toContain('cancel-in-progress: false');
    expect(release).toMatch(/group:\s*release-\$\{\{\s*github\.ref\s*\}\}/);
  });

  it('hace checkout con historial completo', () => {
    expect(release).toContain('fetch-depth: 0');
  });
});

describe('permisos mínimos', () => {
  it('parte sin permisos por defecto', () => {
    expect(release).toMatch(/^permissions: \{\}$/m);
  });

  it('el job de verificación sólo lee', () => {
    const verify = release.slice(release.indexOf('  verify:'), release.indexOf('  publish:'));
    expect(verify).toContain('contents: read');
    expect(verify).not.toContain('contents: write');
    expect(verify).not.toContain('packages: write');
  });

  it('el job de publicación declara exactamente los cuatro permisos de escritura necesarios', () => {
    const publish = release.slice(release.indexOf('  publish:'));
    for (const perm of [
      'contents: write',
      'packages: write',
      'id-token: write',
      'attestations: write',
    ]) {
      expect(publish, `falta ${perm}`).toContain(perm);
    }
    // Nada de permisos amplios.
    expect(publish).not.toMatch(/permissions:\s*write-all/);
    expect(publish).not.toContain('actions: write');
    expect(publish).not.toContain('deployments: write');
    expect(publish).not.toContain('administration: write');
  });

  it('autentica en GHCR sólo con GITHUB_TOKEN, nunca con un PAT', () => {
    expect(release).toMatch(/password: \$\{\{\s*github\.token\s*\}\}/);
    expect(release).not.toMatch(/secrets\.(GHCR|CR|DOCKER|REGISTRY)?_?PAT/i);
    expect(release).not.toMatch(/secrets\.PERSONAL_ACCESS_TOKEN/i);
  });
});

describe('actions fijadas a SHA completo', () => {
  const usesLines = release
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('uses:'));

  it('el workflow usa actions', () => {
    expect(usesLines.length).toBeGreaterThan(4);
  });

  for (const line of usesLines) {
    it(`fija a SHA de 40 caracteres: ${line}`, () => {
      // Una etiqueta móvil (@v4) la puede reescribir el autor de la action, y
      // este workflow tiene packages:write e id-token:write.
      expect(line).toMatch(/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\b/);
    });

    it(`documenta la versión humana: ${line}`, () => {
      expect(line).toMatch(/#\s*v\d+\.\d+\.\d+/);
    });
  }
});

describe('validaciones previas a publicar', () => {
  it('confirma que el commit etiquetado pertenece a main', () => {
    expect(release).toContain('git merge-base --is-ancestor');
    expect(release).toContain('origin/main');
  });

  it('exige CI y Production Gates en success sobre EXACTAMENTE ese SHA', () => {
    expect(release).toContain('head_sha=${GITHUB_SHA}');
    expect(release).toContain('event=push');
    expect(release).toContain('"CI"');
    expect(release).toContain('"Production Gates"');
    expect(release).toMatch(/if \[ "\$conclusion" != "success" \]/);
  });

  it('ejecuta el validador de contrato tag ↔ versión', () => {
    expect(release).toContain('scripts/validate-release-tag.mjs');
  });

  it('rechaza si ya existe un release para el tag', () => {
    expect(release).toContain('gh release view');
    expect(release).toMatch(/ya existe un GitHub Release/i);
  });
});

describe('imagen publicada', () => {
  it('publica la etiqueta de versión y la etiqueta por SHA completo', () => {
    expect(release).toContain('IMAGE_NAME: ' + IMAGE);
    expect(release).toContain('${{ env.IMAGE_NAME }}:${{ needs.verify.outputs.image_tag }}');
    expect(release).toContain('${{ env.IMAGE_NAME }}:sha-${{ github.sha }}');
  });

  it('NO publica etiquetas mutables', () => {
    for (const mutable of [':latest', ':edge', ':main', ':stable']) {
      expect(release, `no debe publicar ${mutable}`).not.toContain(`${IMAGE}${mutable}`);
    }
    expect(release).not.toMatch(/type=raw,value=latest/);
  });

  it('construye manifiesto multi-arquitectura', () => {
    expect(release).toContain('linux/amd64,linux/arm64');
  });

  it('genera provenance mode=max y SBOM', () => {
    expect(release).toContain('provenance: mode=max');
    expect(release).toMatch(/^\s*sbom: true$/m);
  });

  it('adjunta una attestation al nombre completo y al digest', () => {
    expect(release).toContain('attest-build-provenance');
    expect(release).toContain('subject-name: ${{ env.IMAGE_NAME }}');
    expect(release).toContain('subject-digest: ${{ steps.build.outputs.digest }}');
  });

  it('pasa metadata OCI por build-args, sin secretos', () => {
    for (const arg of ['IMAGE_SOURCE=', 'IMAGE_REVISION=', 'IMAGE_VERSION=', 'IMAGE_CREATED=']) {
      expect(release).toContain(arg);
    }
    const buildArgs = release.slice(release.indexOf('build-args:'), release.indexOf('- name: Attestation'));
    expect(buildArgs).not.toMatch(/SERVICE_ROLE|SECRET|PASSWORD|TOKEN/i);
  });

  it('deriva la fecha del commit, no de una llamada arbitraria por intento', () => {
    expect(release).toContain('git show -s --format=%cI');
    expect(release).not.toMatch(/created=\$\(date /);
  });
});

describe('el release se crea DESPUÉS del smoke por digest', () => {
  it('verifica la imagen publicada referenciándola por digest', () => {
    expect(release).toContain('${IMAGE_NAME}@${DIGEST}');
    expect(release).toContain('docker pull "$REF"');
  });

  it('el smoke comprueba health y runtime-config', () => {
    const smoke = release.slice(release.indexOf('Smoke POR DIGEST'));
    expect(smoke).toContain('/api/health/live');
    expect(smoke).toContain('/runtime-config.js');
  });

  it('el smoke falla si un marcador de secreto aparece en la respuesta', () => {
    expect(release).toContain('FUGA DE SECRETO');
  });

  it('la creación del release aparece después del smoke y del manifiesto', () => {
    const smokeAt = release.indexOf('Smoke POR DIGEST');
    const manifestAt = release.indexOf('Manifiesto del release');
    const releaseAt = release.indexOf('gh release create');

    expect(smokeAt).toBeGreaterThan(-1);
    expect(manifestAt).toBeGreaterThan(smokeAt);
    expect(releaseAt).toBeGreaterThan(manifestAt);
  });

  it('marca prerelease los rc y latest los estables', () => {
    expect(release).toContain('--prerelease');
    expect(release).toContain('--latest');
    expect(release).toContain('"${{ needs.verify.outputs.prerelease }}" = "true"');
  });

  it('usa notas generadas y adjunta el manifiesto', () => {
    expect(release).toContain('--generate-notes');
    expect(release).toContain('release-manifest.json');
  });

  it('el manifiesto contiene los campos de trazabilidad', () => {
    const manifest = release.slice(release.indexOf('Manifiesto del release'), release.indexOf('Crear el GitHub Release'));
    for (const field of ['"tag"', '"version"', '"prerelease"', '"sourceSha"', '"digest"', '"platforms"', '"created"']) {
      expect(manifest, `falta ${field}`).toContain(field);
    }
  });
});

describe('el workflow de release no despliega ni toca infraestructura', () => {
  const forbidden: Array<[string, RegExp]> = [
    ['supabase db push', /supabase db push/i],
    ['psql', /\bpsql\b/],
    ['aplicar migraciones', /migrat(e|ion).*(apply|push|run)/i],
    ['coolify', /coolify/i],
    ['ssh a un host', /\bssh\s+[\w.-]+@/],
    ['routeros / mikrotik', /routeros|mikrotik/i],
    ['activar gates live', /NUGACORE_LIVE_MODE\s*[:=]\s*true|MIKROTIK_WORKER_COMMIT\s*[:=]\s*true/],
    ['kubectl', /\bkubectl\b/],
    ['docker compose up', /docker\s+compose\s+up/],
  ];

  for (const [label, pattern] of forbidden) {
    it(`no contiene ${label}`, () => {
      expect(releaseCode).not.toMatch(pattern);
    });
  }

  it('sólo referencia Supabase con valores falsos de smoke', () => {
    const supabaseRefs = releaseCode.match(/supabase[\w.-]*/gi) ?? [];
    for (const ref of supabaseRefs) {
      expect(ref.toLowerCase()).toMatch(/supabase(_url|_anon_key|_service_role_key|_secret_key)?$|supabase\.invalid/i);
    }
    expect(release).toContain('.supabase.invalid');
  });
});

describe('los gates existentes siguen intactos', () => {
  it('production-gates conserva los seis fixtures PostgreSQL 17', () => {
    for (const fixture of [
      'webhook',
      'customer-delete',
      'schema-replay',
      'portal-config',
      'contract-sign',
      'customer-suspension-blocks',
    ]) {
      expect(gates).toContain(`npm run test:db:postgres17 -- ${fixture}`);
    }
  });

  it('ambos workflows conservan el gate de nombres de migración', () => {
    expect(ci).toContain('npm run validate:migration-files');
    expect(gates).toContain('npm run validate:migration-files');
  });

  it('production-gates añade el smoke hermético de contenedor', () => {
    expect(gates).toContain('container-smoke:');
    expect(gates).toContain('needs: quality');
    expect(gates).toContain('/runtime-config.js');
  });

  it('el smoke de PR no publica ninguna imagen', () => {
    const smoke = gates.slice(gates.indexOf('container-smoke:'));
    expect(smoke).not.toContain('docker push');
    expect(smoke).not.toContain('ghcr.io');
  });

  it('el smoke de PR usa un puerto efímero y limpia el contenedor', () => {
    const smoke = gates.slice(gates.indexOf('container-smoke:'), gates.indexOf('webhook-postgres17:'));
    expect(smoke).toContain('docker run -d -P');
    expect(smoke).toContain('trap cleanup EXIT');
    expect(smoke).toContain('docker rm -f');
    // Espera acotada, nunca indefinida.
    expect(smoke).toMatch(/for i in \$\(seq 1 \d+\)/);
  });
});
