import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseContractTemplateRepository } from '../../backend/domains/contract-templates/service';
import type { ContractClause, SaveContractTemplateCommand } from '../../backend/domains/contract-templates/types';

type TemplateRow = {
  id: string;
  tenant_id: string;
  clauses: ContractClause[];
  version: number;
  show_in_portal: boolean;
  created_at: string;
  updated_at: string;
};

type CapturedRequest = {
  method: string;
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | Record<string, unknown>[] | null;
};

const SERVICE_ROLE_KEY = 'service-role-contract-test-key';

const row = (tenantId: string, version: number, cuerpo: string): TemplateRow => ({
  id: `template-${tenantId}`,
  tenant_id: tenantId,
  clauses: [{ id: 'servicio', titulo: 'Servicio', cuerpo, activa: true }],
  version,
  show_in_portal: false,
  created_at: '2026-08-09T00:00:00.000Z',
  updated_at: '2026-08-09T00:00:00.000Z',
});

const command = (tenantId: string, expectedVersion: number, cuerpo: string): SaveContractTemplateCommand => ({
  tenantId,
  expectedVersion,
  clauses: [{ id: 'servicio', titulo: 'Servicio', cuerpo, activa: true }],
  showInPortal: true,
});

const filterValue = (url: URL, field: string): string | null => {
  const value = url.searchParams.get(field);
  return value?.startsWith('eq.') ? value.slice(3) : null;
};

const createPostgrestDouble = (initialRows: TemplateRow[]) => {
  const rows = new Map(initialRows.map((item) => [item.tenant_id, structuredClone(item)]));
  const requests: CapturedRequest[] = [];

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET'
      ? null
      : await request.clone().json() as Record<string, unknown> | Record<string, unknown>[];
    requests.push({ method: request.method, url, headers: request.headers, body });

    if (url.pathname !== '/rest/v1/contract_templates') {
      return Response.json({ message: 'route not found' }, { status: 404 });
    }
    if (request.headers.get('authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
      return Response.json({ code: '42501', message: 'service_role required' }, { status: 403 });
    }

    const tenantId = filterValue(url, 'tenant_id');
    if (request.method === 'GET') {
      const current = tenantId ? rows.get(tenantId) : null;
      return Response.json(current ? [structuredClone(current)] : []);
    }

    if (request.method === 'POST') {
      const inserted = (Array.isArray(body) ? body[0] : body) as TemplateRow;
      if (rows.has(inserted.tenant_id)) {
        return Response.json({ code: '23505', message: 'duplicate key value violates unique constraint' }, { status: 409 });
      }
      rows.set(inserted.tenant_id, structuredClone(inserted));
      return Response.json(structuredClone(inserted));
    }

    if (request.method === 'PATCH') {
      const expectedVersion = Number(filterValue(url, 'version'));
      const current = tenantId ? rows.get(tenantId) : null;
      if (!tenantId || !current || current.version !== expectedVersion) return Response.json([]);
      const updated = { ...current, ...body as Record<string, unknown> } as TemplateRow;
      rows.set(tenantId, structuredClone(updated));
      return Response.json([structuredClone(updated)]);
    }

    return Response.json({ message: 'method not allowed' }, { status: 405 });
  });

  const client = () => createClient('https://postgrest.test', SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });

  return { client, fetch, requests, rows };
};

describe('SupabaseContractTemplateRepository PostgREST contract', () => {
  it('lee y actualiza A sin tocar B, con PATCH cercado por tenant_id y version', async () => {
    const double = createPostgrestDouble([
      row('tenant-a', 5, 'A v5'),
      row('tenant-b', 8, 'B v8'),
    ]);
    const repositoryA = new SupabaseContractTemplateRepository(double.client());
    const repositoryB = new SupabaseContractTemplateRepository(double.client());

    expect(await repositoryA.get('tenant-a')).toMatchObject({ tenantId: 'tenant-a', version: 5 });
    expect(await repositoryB.get('tenant-b')).toMatchObject({ tenantId: 'tenant-b', version: 8 });
    const saved = await repositoryA.save(command('tenant-a', 5, 'A v6'));

    expect(saved).toMatchObject({ tenantId: 'tenant-a', version: 6 });
    expect(double.rows.get('tenant-a')).toMatchObject({ tenant_id: 'tenant-a', version: 6 });
    expect(double.rows.get('tenant-b')).toEqual(row('tenant-b', 8, 'B v8'));

    const patch = double.requests.find((request) => request.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch?.url.searchParams.get('tenant_id')).toBe('eq.tenant-a');
    expect(patch?.url.searchParams.get('version')).toBe('eq.5');
    expect(patch?.body).toMatchObject({ version: 6, show_in_portal: true });
    expect(double.requests.every((request) => request.headers.get('authorization') === `Bearer ${SERVICE_ROLE_KEY}`)).toBe(true);
  });

  it('convierte PATCH stale de cero filas en 409 sin insert ni fallback y conserva ambos tenants', async () => {
    const double = createPostgrestDouble([
      row('tenant-a', 6, 'A vigente'),
      row('tenant-b', 8, 'B vigente'),
    ]);
    const repository = new SupabaseContractTemplateRepository(double.client());

    await expect(repository.save(command('tenant-a', 5, 'A obsoleto'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONTRACT_TEMPLATE_VERSION_CONFLICT',
    });

    expect(double.requests.map((request) => request.method)).toEqual(['PATCH']);
    expect(double.rows.get('tenant-a')).toEqual(row('tenant-a', 6, 'A vigente'));
    expect(double.rows.get('tenant-b')).toEqual(row('tenant-b', 8, 'B vigente'));
  });

  it('crea una fila nueva sólo mediante INSERT cuando expectedVersion es cero', async () => {
    const double = createPostgrestDouble([row('tenant-b', 8, 'B vigente')]);
    const repository = new SupabaseContractTemplateRepository(double.client());

    const saved = await repository.save(command('tenant-c', 0, 'C v1'));

    expect(double.requests[0]?.body).toMatchObject({ tenant_id: 'tenant-c', version: 1 });
    expect(saved).toMatchObject({ tenantId: 'tenant-c', version: 1 });
    expect(double.requests.map((request) => request.method)).toEqual(['POST']);
    expect(double.rows.get('tenant-b')).toEqual(row('tenant-b', 8, 'B vigente'));
  });
});
