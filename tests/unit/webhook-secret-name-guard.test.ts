import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ====================================================================
// B7 — El nombre del secreto de Mercado Pago.
//
// El backend resuelve el secreto como
// `process.env[`WEBHOOK_SECRET_${provider.toUpperCase()}`]` y el proveedor
// interno se llama `mercado_pago`, así que la ÚNICA variable que alguien lee
// es `WEBHOOK_SECRET_MERCADO_PAGO`.
//
// El nombre sin guion bajo no lo lee nadie: en runtime endurecido el webhook
// responde 503 y los cobros se rompen en silencio. La ruta HTTP
// `/api/payments/webhook/mercadopago` SÍ va sin guion bajo — es una ruta, no
// una variable, y no debe tocarse.
//
// Este archivo NUNCA contiene el literal prohibido: se compone en tiempo de
// ejecución para que el propio gate no se autocapture.
// ====================================================================

const WRONG_NAME = ['WEBHOOK_SECRET', 'MERCADOPAGO'].join('_');
const CORRECT_NAME = ['WEBHOOK_SECRET', 'MERCADO', 'PAGO'].join('_');

/**
 * Detecta el nombre incorrecto usado como ASIGNACIÓN/configuración.
 *
 * Se permite deliberadamente que un documento lo mencione en prosa para decir
 * que no debe usarse (`No usar \`WEBHOOK_SECRET_MERCADOPAGO\`…`). Lo que se
 * bloquea es su uso como variable configurable, con o sin `export`.
 */
export const findForbiddenSecretAssignments = (
  content: string,
  wrongName = WRONG_NAME,
): Array<{ line: number; text: string }> => {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${wrongName}\\s*=`);
  return content
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text }))
    .filter((entry) => pattern.test(entry.text));
};

/** Recorre un directorio de documentación en busca de archivos de texto. */
const walkDocs = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDocs(full));
    else if (/\.(md|env|example|ya?ml|sh)$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
};

const SCANNED_FILES = [
  '.env.example',
  '.env.production.example',
  ...walkDocs('docs/deployment'),
  ...walkDocs('docs/runbooks'),
  ...walkDocs('docs/operations'),
];

describe('detector de asignaciones prohibidas (función pura)', () => {
  it('marca una asignación simple', () => {
    const content = `${WRONG_NAME}=__SECRET__`;
    expect(findForbiddenSecretAssignments(content)).toHaveLength(1);
  });

  it('marca una asignación con export y con indentación', () => {
    const content = [`export ${WRONG_NAME}=abc`, `   ${WRONG_NAME}=def`].join('\n');
    expect(findForbiddenSecretAssignments(content)).toHaveLength(2);
  });

  it('marca una asignación con espacios alrededor del igual', () => {
    expect(findForbiddenSecretAssignments(`${WRONG_NAME} = abc`)).toHaveLength(1);
  });

  it('NO marca una mención en prosa que advierte de no usarlo', () => {
    const content = `No usar \`${WRONG_NAME}\`; ese nombre no lo lee el proveedor.`;
    expect(findForbiddenSecretAssignments(content)).toEqual([]);
  });

  it('NO marca el nombre correcto', () => {
    expect(findForbiddenSecretAssignments(`${CORRECT_NAME}=__SECRET__`)).toEqual([]);
  });

  it('NO marca la ruta HTTP del webhook, que sí va sin guion bajo', () => {
    const content = 'POST /api/payments/webhook/mercadopago';
    expect(findForbiddenSecretAssignments(content)).toEqual([]);
  });

  it('devuelve el número de línea del incumplimiento', () => {
    const content = ['# nota', '', `${WRONG_NAME}=x`].join('\n');
    expect(findForbiddenSecretAssignments(content)[0].line).toBe(3);
  });
});

describe('la documentación operativa no configura el nombre incorrecto', () => {
  it('escanea plantillas de entorno, deployment, runbooks y operations', () => {
    // Si la lista quedara vacía, el gate pasaría sin comprobar nada.
    expect(SCANNED_FILES.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of SCANNED_FILES) {
      const hits = findForbiddenSecretAssignments(readFileSync(file, 'utf8'));
      for (const hit of hits) offenders.push(`${file}:${hit.line}`);
    }

    expect(offenders, `usan ${WRONG_NAME} como asignación: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('la plantilla de producción declara el nombre correcto', () => {
    const production = readFileSync('.env.production.example', 'utf8');
    const assignments = production
      .split(/\r?\n/)
      .filter((line) => new RegExp(`^\\s*(?:export\\s+)?${CORRECT_NAME}\\s*=`).test(line));

    expect(assignments.length).toBeGreaterThanOrEqual(1);
  });

  it('el checklist de Coolify usa el nombre correcto', () => {
    const checklist = readFileSync('docs/deployment/COOLIFY_VPS_5.180.151.109_CHECKLIST.md', 'utf8');

    expect(checklist).toContain(`${CORRECT_NAME}=__SECRET__`);
    expect(findForbiddenSecretAssignments(checklist)).toEqual([]);
  });
});
