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
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const gatesWorkflow = readFileSync('.github/workflows/production-gates.yml', 'utf8');

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
