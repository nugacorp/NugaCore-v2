import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SupabaseCustomersRepository } from '../../backend/domains/customers/repository';

// ====================================================================
// PR-1A.2 — tenant_id en las escrituras de client_timeline.
//
// El repositorio deriva el tenant de la fila del cliente propietario antes de
// insertar, para cualquier event_type. La derivación es fail-closed: sin
// tenant legible NO se escribe, en vez de sellar 'tenant-default' — ese
// fallback es el mismo patrón fail-open que PR-1B debe eliminar.
//
// OJO con el alcance: esto etiqueta correctamente el evento, pero NO impide
// una escritura cruzada. Si el WISP A invoca notifyInvoice con una factura de
// B, aquí se resolvería 'tenant-b' y el evento se escribiría en el timeline de
// B, bien etiquetado. MT-01 se cierra en PR-1A.3, acotando factura y cliente
// por tenant_id + id en el servicio.
// ====================================================================

/** Doble de Supabase: devuelve `clientTenant` al resolver y captura el insert. */
const fakeSupabase = (clientTenant: string | null, inserts: Array<Record<string, unknown>>) => ({
  from(table: string) {
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: clientTenant === null ? null : { tenant_id: clientTenant },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'client_timeline') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`Unexpected table ${table}`);
  },
});

describe('SupabaseCustomersRepository — derivación de tenant en el timeline', () => {
  it('deriva tenant_id desde el cliente antes de insertar', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const repo = new SupabaseCustomersRepository(fakeSupabase('tenant-b', inserts) as never);

    await repo.addTimelineEvent({
      clientId: 'c-123',
      eventType: 'status_change',
      summary: 'Status updated',
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ client_id: 'c-123', tenant_id: 'tenant-b' });
  });

  it('aplica a todos los event_type, no solo a los de facturación', async () => {
    const eventTypes = ['created', 'status_change', 'lead_conversion', 'updated', 'note'] as const;
    const inserts: Array<Record<string, unknown>> = [];
    const repo = new SupabaseCustomersRepository(fakeSupabase('tenant-b', inserts) as never);

    for (const eventType of eventTypes) {
      await repo.addTimelineEvent({ clientId: `c-${eventType}`, eventType, summary: `Event ${eventType}` });
    }

    expect(inserts).toHaveLength(eventTypes.length);
    for (const insert of inserts) expect(insert).toMatchObject({ tenant_id: 'tenant-b' });
  });

  it('NO escribe si el cliente no existe — fail-closed, sin tenant-default', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const repo = new SupabaseCustomersRepository(fakeSupabase(null, inserts) as never);

    await expect(
      repo.addTimelineEvent({ clientId: 'c-fantasma', eventType: 'note', summary: 'x' }),
    ).rejects.toThrow(/sin tenant_id resoluble/);
    expect(inserts, 'no debe haberse insertado nada').toHaveLength(0);
  });

  it('NO escribe si el tenant del cliente viene vacío', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const repo = new SupabaseCustomersRepository(fakeSupabase('   ', inserts) as never);

    await expect(
      repo.addTimelineEvent({ clientId: 'c-1', eventType: 'note', summary: 'x' }),
    ).rejects.toThrow(/sin tenant_id resoluble/);
    expect(inserts).toHaveLength(0);
  });

  it('nunca sella tenant-default por defecto', () => {
    const source = readFileSync('backend/domains/customers/repository.ts', 'utf8');
    const from = source.indexOf('async addTimelineEvent');
    const body = source.slice(from, source.indexOf('\n  }', from));
    expect(body, 'addTimelineEvent no debe tener fallback a tenant-default').not.toContain('tenant-default');
  });
});

// ====================================================================
// Inventario de escritores directos al store.
//
// Dos rutas escriben el timeline con `store.addClientTimelineEvent`, saltándose
// el repositorio: no persisten ni llevan tenant_id ni con USE_DB_CUSTOMERS=true.
// Quedan fuera de PR-1A.2 a propósito (mutan el store de forma síncrona; ver los
// comentarios en cada sitio) y se cierran en PR-3. Este test fija el inventario
// para que no aparezcan nuevos sin que nadie se entere.
// ====================================================================
describe('escritores directos al store (fuera del repositorio)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

  // `customers/repository.ts` aparece porque StoreCustomersRepository ES la
  // implementación en modo memoria del repositorio — no es un bypass, es el
  // camino legítimo cuando USE_DB_CUSTOMERS=false.
  const REPOSITORY_ITSELF = 'backend/domains/customers/repository.ts';

  /** Bypasses reales: escriben el timeline sin pasar por el repositorio. */
  const KNOWN_BYPASSES = [
    'backend/domains/billing/routes.ts',
    'backend/domains/suspension/routes.ts',
  ];

  it('siguen siendo exactamente los bypasses conocidos', () => {
    const sites = walk('backend/domains')
      .filter((f) => readFileSync(f, 'utf8').includes('store.addClientTimelineEvent'))
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f !== REPOSITORY_ITSELF)
      .sort();

    expect(sites).toEqual(KNOWN_BYPASSES);
  });

  it('cada bypass documenta por qué no pasa por el repositorio', () => {
    for (const f of KNOWN_BYPASSES) {
      expect(readFileSync(f, 'utf8'), `${f} sin nota de alcance`).toMatch(/NOTA \(PR-1A\.2\)/);
    }
  });
});
