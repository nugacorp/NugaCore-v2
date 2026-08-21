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
