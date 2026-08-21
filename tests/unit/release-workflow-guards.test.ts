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
    expect(release).toMatch(/uses: actions\/attest@[0-9a-f]{40}/);
    expect(release).toContain('subject-name: ${{ env.IMAGE_NAME }}');
    expect(release).toContain('subject-digest: ${{ steps.build.outputs.digest }}');
    expect(release).toContain('push-to-registry: true');
  });

  it('usa la action unificada actual, no la envoltura anterior', () => {
    expect(releaseCode).not.toContain('actions/attest-build-provenance');
  });

  it('desactiva el registro en el almacén para no pedir un quinto permiso', () => {
    // `create-storage-record: true` exigiría `artifact-metadata: write`.
    expect(release).toContain('create-storage-record: false');
    expect(releaseCode).not.toContain('artifact-metadata');
  });

  it('el subject-name se declara sin etiqueta', () => {
    const line = release.split('\n').find((l) => l.includes('subject-name:'))!;
    expect(line).toContain('${{ env.IMAGE_NAME }}');
    expect(line).not.toMatch(/IMAGE_NAME \}\}:/);
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

describe('guarda contra colisión de etiquetas en GHCR', () => {
  const publish = release.slice(release.indexOf('  publish:'));
  const guard = publish.slice(
    publish.indexOf('Rechazar si alguna etiqueta objetivo'),
    publish.indexOf('docker/build-push-action'),
  );

  it('delega en el script hermético, con las dos referencias objetivo', () => {
    expect(guard).toContain('node scripts/check-ghcr-tags-absent.mjs');
    expect(guard).toContain('${{ needs.verify.outputs.image_tag }}');
    expect(guard).toContain('"sha-${GITHUB_SHA}"');
  });

  it('NUNCA usa el GITHUB_TOKEN codificado como bearer del registry', () => {
    // El error original: `BEARER=$(printf '%s' "$TOKEN" | base64 -w0)`.
    // El GITHUB_TOKEN sólo vale como Basic ante el token service; el bearer
    // del Registry v2 es el token OPACO que ese servicio devuelve.
    expect(release).not.toMatch(/BEARER=/);
    expect(release).not.toMatch(/base64/);
    for (const wf of [release, gates]) {
      expect(wf).not.toMatch(/Authorization: Bearer \$\{?\w*TOKEN/);
    }
  });

  it('ocurre DESPUÉS del login y ANTES del build/push', () => {
    const loginAt = publish.indexOf('docker/login-action');
    const guardAt = publish.indexOf('Rechazar si alguna etiqueta objetivo ya existe en GHCR');
    const buildAt = publish.indexOf('docker/build-push-action');

    expect(loginAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(loginAt);
    expect(buildAt).toBeGreaterThan(guardAt);
  });

  it('no oculta fallos', () => {
    expect(guard).not.toContain('|| true');
    expect(guard).toContain('set -euo pipefail');
  });

  it('no borra ni sobrescribe ninguna referencia', () => {
    expect(guard).not.toContain('docker rmi');
    expect(guard).not.toContain('-X DELETE');
  });
});

describe('el script de la guarda GHCR implementa Registry v2', () => {
  const script = readFileSync('scripts/check-ghcr-tags-absent.mjs', 'utf8');

  it('canjea Basic por un bearer en el token service', () => {
    expect(script).toContain('https://ghcr.io/token');
    expect(script).toContain('Basic ${basic}');
    expect(script).toContain('Bearer ${bearer}');
  });

  it('pide el scope de pull sobre el repositorio fijado', () => {
    expect(script).toContain('repository:${repository}:pull');
    expect(script).toContain("OCI_REPOSITORY = 'nugacorp/nugacore-v2'");
  });

  it('acepta token y access_token', () => {
    expect(script).toContain('payload.token');
    expect(script).toContain('payload.access_token');
  });

  it('clasifica todos los códigos de manifest de forma fail-closed', () => {
    for (const code of ['404', '200', '401', '403', '429']) {
      expect(script, `falta el caso ${code}`).toContain(`case ${code}:`);
    }
    expect(script).toContain('response.status >= 500');
    expect(script).toContain('indeterminado');
  });

  it('nunca usa el GITHUB_TOKEN como bearer del registry', () => {
    expect(script).not.toMatch(/Bearer \$\{(password|token)\}/);
    // El único base64 del script es el de la credencial Basic.
    const base64Lines = script.split('\n').filter((l) => l.includes("toString('base64')"));
    expect(base64Lines).toHaveLength(1);
    expect(base64Lines[0]).toContain('${actor}:${password}');
  });

  it('acota el tiempo de espera', () => {
    expect(script).toContain('AbortSignal.timeout');
    expect(script).toContain('DEFAULT_TIMEOUT_MS');
  });

  it('no imprime credenciales, bearer ni la respuesta del token service', () => {
    const logs = script.split('\n').filter((l) => /log\.(log|error)\(/.test(l));
    for (const line of logs) {
      for (const forbidden of ['password', 'basic', 'bearer', 'GITHUB_TOKEN', 'payload', 'raw']) {
        expect(line, `posible fuga: ${line}`).not.toContain(forbidden);
      }
    }
  });
});

describe('el release se crea DESPUÉS del smoke por digest', () => {
  it('verifica la imagen publicada referenciándola por digest', () => {
    expect(release).toContain('${IMAGE_NAME}@${DIGEST}');
    expect(release).toContain('docker pull "$REF"');
  });

  it('el smoke delega en el script compartido, no lo reimplementa', () => {
    const smoke = release.slice(
      release.indexOf('Smoke POR DIGEST'),
      release.indexOf('Manifiesto del release'),
    );
    expect(smoke).toContain('bash scripts/smoke-container.sh');
    // Health y runtime-config los comprueba el script, verificado aparte.
    expect(smoke).not.toContain('/api/health/live');
  });

  it('el smoke falla si un marcador de secreto aparece en la respuesta', () => {
    // La comprobación vive en el script compartido, que ambos workflows usan.
    expect(readFileSync('scripts/smoke-container.sh', 'utf8')).toContain('FUGA DE SECRETO');
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

  it('el workflow no referencia ninguna instancia real de Supabase', () => {
    const supabaseRefs = releaseCode.match(/supabase[\w.-]*/gi) ?? [];
    for (const ref of supabaseRefs) {
      expect(ref.toLowerCase()).toMatch(/supabase(_url|_anon_key|_service_role_key|_secret_key)?$/i);
    }
  });

  it('el script de smoke sólo usa dominios .invalid, que nunca resuelven', () => {
    const smoke = readFileSync('scripts/smoke-container.sh', 'utf8');
    const hosts = smoke.match(/https?:\/\/[\w.-]+/gi) ?? [];
    for (const host of hosts) {
      expect(host, `host no hermético: ${host}`).toMatch(/\.invalid|127\.0\.0\.1/);
    }
    expect(smoke).toContain('.supabase.invalid');
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

  it('ambos workflows invocan EXACTAMENTE el mismo script de smoke', () => {
    // Dos copias divergieron una vez: la de release omitía
    // MIKROTIK_CREDENTIALS_KEY, que el fail-fast de producción exige, así que
    // el primer release habría publicado la imagen y fallado al arrancarla.
    expect(gates).toContain('bash scripts/smoke-container.sh');
    expect(release).toContain('bash scripts/smoke-container.sh');
  });

  it('ninguno reimplementa el smoke en shell', () => {
    for (const [name, wf] of [['production-gates', gates], ['release', release]] as const) {
      expect(wf, `${name} no debe arrancar el contenedor por su cuenta`).not.toContain('docker run -d -P');
      expect(wf, `${name} no debe reimplementar la espera de health`).not.toContain('/api/health/live');
    }
  });

  it('release pasa la referencia POR DIGEST al script', () => {
    expect(release).toContain('REF="${IMAGE_NAME}@${DIGEST}"');
    expect(release).toContain('bash scripts/smoke-container.sh "$REF"');
  });
});

describe('el script de smoke compartido', () => {
  const smoke = readFileSync('scripts/smoke-container.sh', 'utf8');

  it('exige una referencia de imagen', () => {
    expect(smoke).toContain('IMAGE_REF="${1:-}"');
    expect(smoke).toContain('exit 2');
  });

  it('arranca en NODE_ENV=production con AUTH_TRUST_HEADERS=false', () => {
    expect(smoke).toContain('-e NODE_ENV=production');
    expect(smoke).toContain('-e AUTH_TRUST_HEADERS=false');
  });

  it('satisface el fail-fast de producción, incluido MIKROTIK_CREDENTIALS_KEY', () => {
    // Era exactamente lo que faltaba en la copia de release.
    for (const required of [
      '-e MIKROTIK_CREDENTIALS_KEY=',
      '-e SUPABASE_URL=',
      '-e SUPABASE_SERVICE_ROLE_KEY=',
    ]) {
      expect(smoke, `falta ${required}`).toContain(required);
    }
  });

  it('apaga stores DB, pollers y gates live de forma explícita', () => {
    for (const off of [
      '-e USE_DB_CUSTOMERS=false',
      '-e USE_DB_PAYMENTS=false',
      '-e NOC_POLLER_ENABLED=false',
      '-e SNMP_POLLER_ENABLED=false',
      '-e NUGACORE_LIVE_MODE=false',
      '-e MIKROTIK_WORKER_COMMIT=false',
      '-e PAYMENTS_ROUTER_LIVE=false',
    ]) {
      expect(smoke, `falta ${off}`).toContain(off);
    }
  });

  it('usa dominios .invalid', () => {
    expect(smoke).toContain('.invalid');
  });

  it('no imprime el marcador de secreto', () => {
    const echoes = smoke.split('\n').filter((l) => l.trim().startsWith('echo'));
    for (const line of echoes) {
      expect(line, `imprime el marcador: ${line}`).not.toContain('SECRET_MARKER');
    }
  });

  it('usa puerto efímero, trap de limpieza y espera acotada', () => {
    expect(smoke).toContain('docker run -d -P');
    expect(smoke).toContain('trap cleanup EXIT');
    expect(smoke).toContain('docker rm -f');
    expect(smoke).toContain('HEALTH_TIMEOUT_SECONDS');
  });

  it('detecta que el contenedor murió antes de responder health', () => {
    expect(smoke).toContain('.State.Running');
    expect(smoke).toContain('terminó antes de responder health');
  });

  it('verifica cabeceras, config pública y ausencia de secretos', () => {
    expect(smoke).toContain('cache-control');
    expect(smoke).toContain('application/javascript');
    expect(smoke).toContain('FUGA DE SECRETO');
  });

  it('no hace pull ni push por su cuenta', () => {
    expect(smoke).not.toContain('docker pull');
    expect(smoke).not.toContain('docker push');
  });
});
