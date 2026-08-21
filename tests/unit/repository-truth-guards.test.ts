import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// B5/B6 — Guardas mínimas de verdad documental y de CI.
//
// No convierten la documentación en un snapshot frágil: sólo bloquean las
// regresiones concretas que ya ocurrieron una vez.
//   - El README describía el repo como "Fase 0" con datos mock, mucho
//     después de tener 76 migraciones y repositorios Supabase reales.
//   - El gate de nombres de migración podría retirarse de un workflow sin
//     que nadie lo note hasta la siguiente colisión de versiones.
// ====================================================================

const readme = readFileSync('README.md', 'utf8');
const status = readFileSync('docs/reports/PROJECT_STATUS_CURRENT.md', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const gatesWorkflow = readFileSync('.github/workflows/production-gates.yml', 'utf8');
const claude = readFileSync('CLAUDE.md', 'utf8');
const t071Result = readFileSync('docs/results/STAGING_MIGRATION_PARITY_V2.0.0_RC1_RESULT.md', 'utf8');

describe('el README no reincide en las afirmaciones de Fase 0', () => {
  const retired = [
    'Fase 0 Guardrails',
    'Do not wire real Supabase modules yet',
    'Data is still mock/in-memory in Fase 0 by design',
    'Gemini and Supabase can be empty during Fase 0',
  ];

  for (const claim of retired) {
    it(`ya no afirma: ${claim}`, () => {
      expect(readme).not.toContain(claim);
    });
  }

  it('ya no dice que el fencing de webhooks de pago está fuera de main', () => {
    expect(readme).not.toMatch(/fencing correction still outside `main`/i);
    expect(readme).not.toMatch(/verified schema drift in staging/i);
  });

  it('describe el proyecto como plataforma multi-tenant para WISP', () => {
    expect(readme).toMatch(/multi-tenant/i);
    expect(readme).toMatch(/WISP/);
  });

  it('distingue implementado de validado externamente', () => {
    expect(readme).toMatch(/NO validado contra infraestructura externa/i);
  });

  it('no hardcodea un porcentaje de avance', () => {
    expect(readme).not.toMatch(/\b\d{1,3}\s?% (completado|de avance|avanzado)/i);
  });
});

describe('el README no afirma hechos que el repositorio no puede comprobar', () => {
  it('no presenta PostgreSQL 17 como la versión del servicio remoto', () => {
    // El repo sólo puede afirmar la versión de los fixtures de CI. La versión
    // real de la instancia de Supabase requiere consultarla.
    expect(readme).not.toContain('PostgreSQL 17 vía Supabase');
    expect(readme).not.toMatch(/Supabase\s*\/\s*PostgreSQL 17/);
  });

  it('sigue pudiendo hablar de PostgreSQL 17 para los fixtures de CI', () => {
    expect(readme).toMatch(/fixtures[^.]*PostgreSQL 17|PostgreSQL 17[^.]*fixtures/i);
  });

  it('no afirma que TODOS los dominios tengan persistencia dual', () => {
    expect(readme).not.toContain('Cada dominio puede correr contra el store en memoria o contra Supabase');
    // Debe declarar explícitamente que el patrón no es universal.
    expect(readme).toMatch(/no es universal/i);
  });

  it('declara que la escritura RouterOS no está validada', () => {
    expect(readme).toMatch(/escritura RouterOS no ha sido validada/i);
    // Y no debe presentar el CHR emulado como validación de escritura.
    expect(readme).not.toContain('Escritura RouterOS: validada sólo en dry-run');
  });
});

describe('el estado actual no colapsa las brechas en una sola categoría', () => {
  it('no afirma que las brechas restantes sean sólo de validación externa', () => {
    expect(status).not.toContain('las brechas que quedan son de *validación externa*, no de código faltante');
    expect(status).not.toMatch(/casi todo está implementado/i);
    expect(status).not.toMatch(/casi nada está probado/i);
  });

  it('reconoce brechas de código y de alcance de producto', () => {
    expect(status).toMatch(/Código y persistencia/i);
    expect(status).toMatch(/Alcance de producto/i);
    expect(status).toMatch(/Esto sí es código faltante/i);
  });

  it('mantiene que no está aprobado para producción', () => {
    expect(status).toMatch(/No está aprobada para producción/i);
  });
});

describe('T071 no se confunde con despliegue, producción o T072/T073', () => {
  // La verificación de paridad de migraciones (T071) sólo demuestra que el
  // ESQUEMA de staging coincide con el repositorio en un momento dado. No
  // demuestra que la imagen esté desplegada allí, ni que producción esté
  // lista, ni que las tareas externas independientes (T072 readiness
  // estricto, T073 restore) estén resueltas. Mezclar esas afirmaciones fue
  // exactamente el tipo de error que este documento existe para evitar.
  it('declara T071 cerrada sin afirmar que staging está desplegado', () => {
    expect(status).toMatch(/T071/);
    expect(status).not.toMatch(/staging est[aá] desplegad[oa] con v2\.0\.0-rc\.1/i);
  });

  it('no declara T072 ni T073 cerradas junto con T071', () => {
    const t071Index = status.indexOf('T071');
    expect(t071Index).toBeGreaterThan(-1);
    const nearby = status.slice(t071Index, t071Index + 800);
    expect(nearby).not.toMatch(/T072[^\n]*cerrad/i);
    expect(nearby).not.toMatch(/T073[^\n]*cerrad/i);
  });

  it('clasifica T071 como VERIFICADO EN STAGING, no como VERIFICADO EN CÓDIGO/CI', () => {
    const t071SectionIndex = status.indexOf('Spec 001 **T071**');
    expect(t071SectionIndex, 'no se encontró la sección de T071').toBeGreaterThan(-1);
    const nearby = status.slice(Math.max(0, t071SectionIndex - 200), t071SectionIndex);
    expect(nearby).toMatch(/VERIFICADO EN STAGING/);
    expect(nearby).not.toMatch(/VERIFICADO EN CÓDIGO\/CI/);
  });

  it('distingue, para T071, la consulta read-only del aprovisionamiento de ACL', () => {
    // La fase completa no fue "toda read-only": hizo falta una mutación
    // administrativa (crear un rol, otorgarle SELECT) para poder correr la
    // consulta de verificación, que sí lo fue. Confundir ambas cosas es
    // exactamente la sobreafirmación que esta guarda bloquea. La prueba exige
    // que ambos elementos estén presentes, en vez de prohibir una frase
    // exacta (que atraparía también la negación explícita y correcta).
    expect(t071Result).toMatch(/mutaci[oó]n administrativa/i);
    expect(t071Result).toMatch(/consulta[^\n]*de solo lectura|de solo lectura[^\n]*consulta/i);
    expect(t071Result).toMatch(/no es lo mismo|no significa|distinta? de/i);
  });

  it('confirma que el rol temporal y sus privilegios fueron retirados de staging', () => {
    expect(t071Result).toMatch(/DROP OWNED BY/);
    expect(t071Result).toMatch(/DROP ROLE/);
    expect(t071Result).toMatch(/cero filas|0 filas|ya no existe/i);
  });

  it('confirma la revocación del PAT sin publicar fragmentos ni fingerprints', () => {
    expect(t071Result).toMatch(/PAT[^\n]*revocad[oa]|revocad[oa][^\n]*PAT|token[^\n]*revocad[oa]/i);
    // Nunca un prefijo reconocible de token de Supabase, ni siquiera parcial.
    expect(t071Result).not.toMatch(/sbp_/i);
  });
});

describe('el gate de nombres de migración está cableado en CI', () => {
  const GATE_STEP = 'Validate migration filenames and unique versions';
  const GATE_CMD = 'npm run validate:migration-files';

  it('ci.yml ejecuta el validador', () => {
    expect(ciWorkflow).toContain(GATE_STEP);
    expect(ciWorkflow).toContain(GATE_CMD);
  });

  it('production-gates.yml ejecuta el validador', () => {
    expect(gatesWorkflow).toContain(GATE_STEP);
    expect(gatesWorkflow).toContain(GATE_CMD);
  });

  it('corre ANTES de la suite pesada en ambos workflows', () => {
    for (const [name, workflow] of [['ci.yml', ciWorkflow], ['production-gates.yml', gatesWorkflow]] as const) {
      const gateAt = workflow.indexOf(GATE_CMD);
      const testAt = workflow.indexOf('npm test');
      const buildAt = workflow.indexOf('npm run build');

      expect(gateAt, `${name}: falta el gate`).toBeGreaterThan(-1);
      expect(gateAt, `${name}: el gate debe preceder a npm test`).toBeLessThan(testAt);
      expect(gateAt, `${name}: el gate debe preceder al build`).toBeLessThan(buildAt);
    }
  });

  it('conserva los fixtures PostgreSQL 17 existentes', () => {
    for (const fixture of [
      'webhook',
      'customer-delete',
      'schema-replay',
      'portal-config',
      'contract-sign',
      'customer-suspension-blocks',
    ]) {
      expect(gatesWorkflow).toContain(`npm run test:db:postgres17 -- ${fixture}`);
    }
  });
});

describe('package.json expone el validador con un nombre inequívoco', () => {
  it('declara validate:migration-files sin depender de dotenv ni de una DB', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['validate:migration-files']).toBe(
      'node scripts/validate-migration-files.mjs',
    );
    // El reporte de drift sigue siendo otra cosa: ese sí puede tocar una DB.
    expect(pkg.scripts['report-migration-drift']).toContain('report-migration-drift.mjs');
  });
});

// ====================================================================
// CLAUDE.md — el incidente que motiva estas guardas.
//
// La primera versión clasificó `test:db`/`test:db:billing`/`test:auth` como
// "skipped, not failed" (son opt-in que FALLA cerrado sin credenciales, según
// scripts/run-tests.mjs y el bloque `if (optIn && !hasSupabase)` de cada
// suite .db.contract.test.ts), agrupó `test:db:postgres17` con ese mismo
// comportamiento (requiere un daemon Docker real y falla si no está, según
// scripts/run-postgres17-fixture.mjs), y puso `report-migration-drift` bajo
// "hermetic, no network" pese a que puede abrir una conexión psql real a una
// URL configurada (scripts/report-migration-drift.mjs, EXTERNAL_BLOCKED sólo
// sin URL). Un agente que confiara en esas frases correría un comando
// pensando que no toca nada externo, y tocaría algo externo.
//
// El mismo incidente de esta fase — un "commit separado" terminó siendo push
// directo a `origin/main` — mostró que la ambigüedad no es sólo documental:
// afecta lo que un agente hace con el repositorio real.
// ====================================================================

describe('CLAUDE.md clasifica correctamente las suites de prueba', () => {
  it('distingue `npm test` hermético de los comandos opt-in', () => {
    expect(claude).toMatch(/npm test\b[^\n]*(?:hermetic|herm[eé]tico)/i);
    expect(claude).toMatch(/opt-in/i);
  });

  it('declara que test:db, test:db:billing y test:auth FALLAN sin credenciales, no que se omiten', () => {
    for (const script of ['test:db', 'test:db:billing', 'test:auth']) {
      expect(claude, `falta mención de ${script}`).toContain(script);
    }

    // La afirmación errónea que esta guarda bloquea explícitamente.
    expect(claude).not.toMatch(/test:db[^\n]*skipped, not failed/i);
    expect(claude).not.toMatch(/opt-in;\s*skipped/i);

    // La afirmación correcta: activar el opt-in sin configuración falla.
    expect(claude).toMatch(/fail(s|ed)? closed|fails? (explicitly|if|when)|falla(n)? (cerrado|si|cuando)/i);
  });

  it('declara que test:db:postgres17 requiere Docker y no se omite silenciosamente si falta', () => {
    const idx = claude.indexOf('test:db:postgres17');
    expect(idx, 'test:db:postgres17 no aparece en CLAUDE.md').toBeGreaterThan(-1);

    const around = claude.slice(Math.max(0, idx - 400), idx + 400);
    expect(around).toMatch(/docker/i);
    expect(around).toMatch(/fail|requiere|required|requires/i);
    // No debe seguir agrupado bajo la misma promesa de "skipped, not failed"
    // que hace el bloque opt-in de Supabase.
    expect(around).not.toMatch(/skipped, not failed/i);
  });

  it('declara que report-migration-drift NO es hermético/sin red y puede tocar una DB remota', () => {
    const idx = claude.indexOf('report-migration-drift');
    expect(idx, 'report-migration-drift no aparece en CLAUDE.md').toBeGreaterThan(-1);

    const around = claude.slice(Math.max(0, idx - 400), idx + 400);
    expect(around).toMatch(/EXTERNAL_BLOCKED|psql|remote|remota/i);
    // La afirmación errónea que esta guarda bloquea explícitamente: agrupar
    // este comando bajo la promesa de "hermetic, no network".
    expect(around).not.toMatch(/hermetic,\s*no network/i);
  });

  it('documenta las CUATRO variables de entorno que activan la lectura remota', () => {
    // Las mismas cuatro que scripts/report-migration-drift.mjs reconoce en
    // DB_URL_ENV_KEYS. Omitir una deja una fuente de URL indocumentada: quien
    // lea CLAUDE.md creería que sin las otras tres el comando es inofensivo,
    // aunque SUPABASE_DB_URL (u otra) esté poblada en el entorno.
    //
    // El comando aparece dos veces (el bloque de comandos y el gotcha
    // detallado); las cuatro variables viven junto a la SEGUNDA mención.
    const idx = claude.lastIndexOf('report-migration-drift');
    const around = claude.slice(Math.max(0, idx - 100), idx + 500);

    for (const envVar of [
      'MIGRATION_DRIFT_DATABASE_URL',
      'STAGING_DATABASE_URL',
      'SUPABASE_DB_URL',
      'DATABASE_URL',
    ]) {
      expect(around, `falta ${envVar} junto a report-migration-drift`).toContain(envVar);
    }
  });

  it('exige rama y PR para todo cambio, incluidos docs y archivos de agentes: nunca push directo a main', () => {
    expect(claude).toMatch(/never push (directly )?to (`?origin\/)?main|nunca (hacer|hagas)? ?push directo a (`?origin\/)?main/i);
    expect(claude).toMatch(/docs?[^\n]*(CLAUDE\.md|agent)|agent[^\n]*docs?/i);
  });
});
