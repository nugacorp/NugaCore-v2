// ====================================================================
// Borrado de cliente: la RPC transaccional y el barrido del bucket.
//
// ATENCIÓN AL ALCANCE DE ESTOS TESTS. Son herméticos: el cliente Supabase es
// un doble y no hay claves foráneas, así que NO pueden demostrar que el
// borrado sea correcto —eso lo prueba el gate PG17
// (`npm run test:db:postgres17 -- customer-delete`) contra un PostgreSQL de
// verdad—. Lo que sí cubren, y el gate no puede porque no atraviesa TypeScript,
// es la capa de arriba: que se llame a la RPC y no a las tablas, cómo se
// traduce el bloqueo, y sobre todo EL ORDEN — que el barrido del bucket ocurra
// después de la transacción y sólo si confirmó.
// ====================================================================

import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../backend/services/supabase-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../backend/services/supabase-storage')>()),
  removeDocumentObject: vi.fn(async () => true),
}));

import { removeDocumentObject } from '../../backend/services/supabase-storage';
import { logger } from '../../backend/common/logger';
import { ConflictError } from '../../backend/common/errors';
import { redactStoragePath } from '../../backend/common/log-redaction';
import {
  SupabaseCustomersRepository,
  clientDeleteBlockedMessage,
} from '../../backend/domains/customers/repository';

type RpcResult = { data: unknown; error: { message: string } | null };

/** Traza compartida: así el orden RPC → barrido es observable, no supuesto. */
let trace: string[] = [];

/**
 * Doble del cliente Supabase. `from()` explota a propósito: si `remove()`
 * volviera a tocar tablas directamente —el borrado multi-write que este
 * ticket elimina— el test lo dice en vez de pasar en silencio.
 */
const makeClient = (result: RpcResult) => {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      trace.push(`rpc:${fn}`);
      rpcCalls.push({ fn, args });
      return result;
    },
    from: (table: string) => {
      throw new Error(`remove() no debe tocar la tabla ${table} directamente`);
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
};

const ok = (paths: string[] | null, extra: Record<string, unknown> = {}): RpcResult => ({
  data: { client_id: 'c-1', tenant_id: 'tenant-default', storage_paths: paths, ...extra },
  error: null,
});

const rpcError = (message: string): RpcResult => ({ data: null, error: { message } });

beforeEach(() => {
  trace = [];
  vi.mocked(removeDocumentObject).mockReset();
  vi.mocked(removeDocumentObject).mockImplementation(async (path: string) => {
    trace.push(`sweep:${path}`);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('remove() — llamada a la RPC', () => {
  it('llama a customers_delete_cascade con el cliente y el tenant', async () => {
    const { client, rpcCalls } = makeClient(ok([]));
    const repo = new SupabaseCustomersRepository(client);

    await expect(repo.remove('c-1', 'tenant-default')).resolves.toBe(true);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('customers_delete_cascade');
    expect(rpcCalls[0].args).toEqual({ p_client_id: 'c-1', p_tenant_id: 'tenant-default' });
  });

  it('sin tenant manda null explícito, no undefined', async () => {
    // PostgREST omite las claves `undefined`, y entonces el parámetro tomaría
    // su DEFAULT en vez de decir "sin filtro de tenant" de forma deliberada.
    const { client, rpcCalls } = makeClient(ok([]));
    await new SupabaseCustomersRepository(client).remove('c-1');

    expect(rpcCalls[0].args).toEqual({ p_client_id: 'c-1', p_tenant_id: null });
  });

  it('no queda ningún borrado tabla a tabla: from() no se toca', async () => {
    const { client } = makeClient(ok([]));
    await expect(new SupabaseCustomersRepository(client).remove('c-1')).resolves.toBe(true);
    // El doble lanzaría si `remove()` hubiera llamado a `from()`.
  });
});

describe('remove() — el orden es el diseño', () => {
  it('barre los objetos DESPUÉS de la RPC, con las rutas que ésta devuelve', async () => {
    const paths = ['tenant-default/c-1/ine.pdf', 'tenant-default/c-1/recibo.pdf'];
    const { client } = makeClient(ok(paths));

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).resolves.toBe(true);

    expect(trace).toEqual([
      'rpc:customers_delete_cascade',
      'sweep:tenant-default/c-1/ine.pdf',
      'sweep:tenant-default/c-1/recibo.pdf',
    ]);
  });

  it('NO barre nada si la RPC bloquea', async () => {
    const { client } = makeClient(
      rpcError('customers_delete_cascade: client_delete_blocked: {"payments": 1}'),
    );

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).rejects.toThrow(
      ConflictError,
    );

    expect(removeDocumentObject).not.toHaveBeenCalled();
    expect(trace).toEqual(['rpc:customers_delete_cascade']);
  });

  it('NO barre nada si el cliente no existe o es de otro tenant', async () => {
    const { client } = makeClient(
      rpcError('customers_delete_cascade: client_not_found: c-999'),
    );

    await expect(new SupabaseCustomersRepository(client).remove('c-999', 'tenant-a')).resolves.toBe(
      false,
    );

    expect(removeDocumentObject).not.toHaveBeenCalled();
  });

  it('NO barre nada si la RPC falla por cualquier otro motivo', async () => {
    // Es el caso que convertiría un fallo de la transacción en borrado de
    // bytes: la fila sigue viva y su objeto habría desaparecido.
    const { client } = makeClient(rpcError('deadlock detected'));

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).rejects.toThrow(
      /Customers DB error \(remove\)/,
    );

    expect(removeDocumentObject).not.toHaveBeenCalled();
  });
});

describe('remove() — el cinturón del 23503', () => {
  // El pre-check de la RPC cuenta los bloqueantes, pero bajo READ COMMITTED un
  // INSERT sin confirmar sobre una factura del cliente es invisible al contarlo,
  // y el `FOR UPDATE` sobre `clients` no lo serializa porque esa tabla no cuelga
  // de `clients`. Si eso ocurre —o si alguna tabla se escapa del cierre de la
  // cascada— el usuario merece el 409 con la salida a Baja comercial, no un 500.
  it('traduce una violación de FK cruda a ConflictError, no a 500', async () => {
    const { client } = makeClient({
      data: null,
      error: {
        message:
          'update or delete on table "invoices" violates foreign key constraint '
          + '"payment_orders_invoice_id_fkey" on table "payment_orders"',
        code: '23503',
      } as { message: string },
    });

    const error = (await new SupabaseCustomersRepository(client)
      .remove('c-1')
      .then(() => null, (e: Error) => e)) as ConflictError;

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain('Baja comercial');
  });

  it('no barre el bucket cuando el 23503 salta: la transacción revirtió', async () => {
    const { client } = makeClient({
      data: null,
      error: { message: 'violates foreign key constraint', code: '23503' } as { message: string },
    });

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).rejects.toThrow(
      ConflictError,
    );
    expect(removeDocumentObject).not.toHaveBeenCalled();
  });

  it('un fallo que no es de integridad sigue siendo 500, no 409', async () => {
    const { client } = makeClient(rpcError('deadlock detected'));

    const error = (await new SupabaseCustomersRepository(client)
      .remove('c-1')
      .then(() => null, (e: Error) => e)) as Error;

    expect(error).not.toBeInstanceOf(ConflictError);
  });
});

describe('diagnóstico de errores de Postgres', () => {
  // Un PostgrestError es un objeto plano, no un Error: `String(error)` lo
  // convertía en `[object Object]`. Desde que `remove()` va por RPC ya no queda
  // rastro tabla a tabla, así que este log es la ÚNICA traza de un fallo no
  // traducido — y sin él, un borrado que falla en producción no deja nada.
  it('no vuelve a registrar [object Object] para un PostgrestError', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { client } = makeClient({
      data: null,
      error: {
        message: 'permission denied for table clients',
        code: '42501',
        details: 'algo mas',
        hint: 'revisa los grants',
      } as { message: string },
    });

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).rejects.toThrow();

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('[object Object]');
    expect(logged).toContain('permission denied for table clients');
    expect(logged).toContain('code=42501');
    expect(logged).toContain('hint=revisa los grants');
  });
});

describe('remove() — el barrido es best-effort', () => {
  it('el borrado sigue siendo un éxito aunque el objeto no se pueda barrer', async () => {
    vi.mocked(removeDocumentObject).mockResolvedValue(false);
    const { client } = makeClient(ok(['tenant-default/c-1/ine.pdf']));

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).resolves.toBe(true);
  });

  it('el borrado sigue siendo un éxito aunque el barrido reviente', async () => {
    vi.mocked(removeDocumentObject).mockRejectedValue(new Error('storage caído'));
    const { client } = makeClient(ok(['tenant-default/c-1/ine.pdf']));

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).resolves.toBe(true);
  });

  it('registra el huérfano SIN el nombre del archivo', async () => {
    vi.mocked(removeDocumentObject).mockResolvedValue(false);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { client } = makeClient(ok(['tenant-default/c-1/1754-INE-Juan-Perez.pdf']));

    await new SupabaseCustomersRepository(client).remove('c-1');

    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('tenant-default/c-1/***');
    expect(logged).not.toContain('Juan-Perez');
    expect(logged).toContain('"orphaned":1');
  });

  it('no llama al barrido cuando la RPC no devuelve rutas', async () => {
    for (const value of [[], null]) {
      vi.mocked(removeDocumentObject).mockClear();
      const { client } = makeClient(ok(value as string[] | null));
      await new SupabaseCustomersRepository(client).remove('c-1');
      expect(removeDocumentObject).not.toHaveBeenCalled();
    }
  });

  it('acepta la respuesta envuelta en array que a veces devuelve PostgREST', async () => {
    const { client } = makeClient({
      data: [{ storage_paths: ['tenant-default/c-1/ine.pdf'] }],
      error: null,
    });

    await expect(new SupabaseCustomersRepository(client).remove('c-1')).resolves.toBe(true);
    expect(removeDocumentObject).toHaveBeenCalledWith('tenant-default/c-1/ine.pdf');
  });
});

describe('clientDeleteBlockedMessage', () => {
  it('nombra qué bloquea y ofrece la Baja comercial', () => {
    const msg = clientDeleteBlockedMessage(
      'customers_delete_cascade: client_delete_blocked: {"payments": 2, "payment_receipts": 1}',
    );

    expect(msg).toContain('historial financiero con obligación de conservación');
    expect(msg).toContain('2 pagos registrados');
    expect(msg).toContain('1 comprobante de pago');
    expect(msg).toContain('Baja comercial');
  });

  it('cae a un mensaje genérico si la RPC cambia de forma, sin inventar detalle', () => {
    const msg = clientDeleteBlockedMessage('client_delete_blocked: no-es-json');
    expect(msg).toContain('historial financiero con obligación de conservación');
    expect(msg).toContain('Baja comercial');
    expect(msg).not.toContain('(');
  });

  it('propaga el nombre crudo de una tabla que aún no tenga etiqueta', () => {
    const msg = clientDeleteBlockedMessage('client_delete_blocked: {"tabla_nueva": 3}');
    expect(msg).toContain('3 tabla_nueva');
  });
});

describe('remove() — el conflicto que ve el usuario', () => {
  it('traduce el bloqueo a ConflictError 409 con mensaje accionable', async () => {
    const { client } = makeClient(
      rpcError(
        'customers_delete_cascade: client_delete_blocked: {"payments": 2, "credit_notes": 1}',
      ),
    );

    const error = (await new SupabaseCustomersRepository(client)
      .remove('c-1')
      .then(() => null, (e: Error) => e)) as ConflictError;

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain('2 pagos registrados');
    expect(error.message).toContain('1 nota de crédito');
  });

  it('no filtra el mensaje crudo de Postgres al usuario', async () => {
    const { client } = makeClient(
      rpcError('customers_delete_cascade: client_delete_blocked: {"payments": 1}'),
    );

    const error = (await new SupabaseCustomersRepository(client)
      .remove('c-1')
      .then(() => null, (e: Error) => e)) as Error;

    expect(error.message).not.toMatch(/customers_delete_cascade|client_delete_blocked|[{}]/);
  });
});

// Cobertura heredada del test anterior: sigue siendo cierta y no la cubre nadie
// más. El CRM conserva el botón Eliminar y muestra el mensaje del backend, que
// ahora es concreto sobre qué bloquea.
describe('App.tsx — el borrado desde el CRM', () => {
  const app = readFileSync('src/App.tsx', 'utf8');

  it('maneja el DELETE y relanza el error para que el CRM lo muestre', () => {
    expect(app).toContain("method: 'DELETE'");
    expect(app).toContain('handleDeleteClient');
    expect(app).toContain('throw new Error(msg,');
  });

  it('fetchJson maneja la respuesta 204 sin cuerpo', () => {
    expect(app).toContain('response.status === 204');
    expect(app).toContain('undefined as unknown as T');
  });
});

// El gate PG17 verifica la RPC contra un PostgreSQL real, pero NO atraviesa
// TypeScript: no hay PostgREST en el contenedor. Así que el punto de unión
// —los literales por los que la capa TS reconoce cada respuesta— no lo cubre
// nadie. Si alguien renombra `client_delete_blocked` en el SQL, el gate sigue
// verde y `remove()` deja de traducir el conflicto: devolvería un error crudo
// en vez del 409 con la salida a Baja comercial. Esto lo ata por los dos lados.
describe('contrato RPC ↔ capa TS', () => {
  const migration = readFileSync(
    'supabase/migrations/20260806120000_customers_delete_cascade.sql',
    'utf8',
  );
  const repository = readFileSync('backend/domains/customers/repository.ts', 'utf8');

  it.each(['client_not_found', 'client_delete_blocked', 'storage_paths'])(
    'la migración y el repositorio hablan de %s',
    (token) => {
      expect(migration).toContain(token);
      expect(repository).toContain(token);
    },
  );

  it('el nombre de la función coincide en ambos lados', () => {
    expect(migration).toContain('FUNCTION public.customers_delete_cascade');
    expect(repository).toContain("rpc('customers_delete_cascade'");
  });

  it('los parámetros que manda el repositorio son los que declara la migración', () => {
    expect(migration).toMatch(/customers_delete_cascade\(\s*p_client_id TEXT,\s*p_tenant_id TEXT/);
    expect(repository).toContain('p_client_id: id');
    expect(repository).toContain('p_tenant_id: tenantId ?? null');
  });
});

describe('redactStoragePath', () => {
  it('enmascara el archivo y conserva la carpeta', () => {
    expect(redactStoragePath('tenant-a/c-7/1754-INE.pdf')).toBe('tenant-a/c-7/***');
  });

  it('tolera rutas sin separador', () => {
    expect(redactStoragePath('suelto.pdf')).toBe('***');
  });
});
