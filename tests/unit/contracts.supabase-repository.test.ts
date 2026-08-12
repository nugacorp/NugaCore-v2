import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseContractsRepository } from '../../backend/domains/contracts/repository';

const row = (tenantId: string) => ({
  id: 'contract-a', tenant_id: tenantId, client_id: 'client-a', template_version: 2,
  rendered_clauses: [], rendered_text: 'frozen', status: 'draft', document_id: null,
  pdf_sha256: null, signed_at: null, voided_at: null,
  created_at: '2026-08-09T12:00:00.000Z', updated_at: '2026-08-09T12:00:00.000Z',
});

describe('SupabaseContractsRepository service_role contract', () => {
  it('filtra simultáneamente por tenant y contrato al leer', async () => {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return builder; }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row('tenant-a'), error: null }),
    };
    const admin = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
    const result = await new SupabaseContractsRepository(admin).get('tenant-a', 'contract-a');
    expect(filters).toEqual([['tenant_id', 'tenant-a'], ['id', 'contract-a']]);
    expect(result).toMatchObject({ tenantId: 'tenant-a', id: 'contract-a' });
  });

  it('pasa a la RPC sólo identidad tenant-scoped y metadatos generados por backend', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      contract_id: 'contract-a', client_id: 'client-a', document_id: 'doc-a', pdf_sha256: 'a'.repeat(64),
      signed_at: '2026-08-09T12:00:00.000Z', already_signed: false, voided_contract_ids: [],
    }, error: null });
    const repository = new SupabaseContractsRepository({ rpc } as unknown as SupabaseClient);
    const result = await repository.signApply({
      tenantId: 'tenant-a', contractId: 'contract-a', documentId: 'doc-a', fileName: 'contract.pdf',
      storagePath: 'tenant-a/client-a/doc-a-contract.pdf', mimeType: 'application/pdf', pdfSha256: 'a'.repeat(64),
      witnessUserId: 'staff-a', witnessRole: 'tecnico', signerIp: '192.0.2.1', userAgent: 'agent', geo: null,
      signedAt: 'ignored-client-time',
    });
    expect(rpc).toHaveBeenCalledWith('contract_sign_apply', expect.objectContaining({
      p_tenant_id: 'tenant-a', p_contract_id: 'contract-a', p_storage_path: 'tenant-a/client-a/doc-a-contract.pdf',
      p_witness_user_id: 'staff-a',
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_signed_at');
    expect(result).toMatchObject({ documentId: 'doc-a', alreadySigned: false });
  });
});
