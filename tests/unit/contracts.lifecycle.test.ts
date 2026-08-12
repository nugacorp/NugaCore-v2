import { describe, expect, it, vi } from 'vitest';
import {
  ContractService,
  MemoryContractsRepository,
  type ContractServiceDependencies,
} from '../../backend/domains/contracts/service';
import type { ContractRecord } from '../../backend/domains/contracts/types';

const record = (id: string, status: ContractRecord['status'] = 'draft'): ContractRecord => ({
  id, tenantId: 'tenant-a', clientId: 'client-a', templateVersion: 2,
  renderedClauses: [{ id: 'one', titulo: 'Uno', cuerpo: 'Texto', activa: true }],
  renderedText: 'Uno\nTexto', status, documentId: status === 'signed' ? `doc-${id}` : null,
  pdfSha256: status === 'signed' ? 'a'.repeat(64) : null,
  signedAt: status === 'signed' ? '2026-08-09T12:00:00.000Z' : null,
  voidedAt: null, createdAt: '2026-08-09T11:00:00.000Z', updatedAt: '2026-08-09T11:00:00.000Z',
});

const setup = () => {
  const repository = new MemoryContractsRepository();
  const deps = {
    repository,
    templates: { getTemplate: vi.fn().mockResolvedValue({ configured: true, showInPortal: true }) },
    customers: { getById: vi.fn() }, plans: { getById: vi.fn() }, tenants: { getTenant: vi.fn() },
    pdf: { renderSignedContract: vi.fn() }, storage: { upload: vi.fn(), remove: vi.fn() },
    id: vi.fn(), now: vi.fn(() => new Date('2026-08-09T13:00:00.000Z')),
  } as unknown as ContractServiceDependencies;
  return { repository, service: new ContractService(deps), deps };
};

describe('Contract lifecycle', () => {
  it('deletes only a same-tenant draft', async () => {
    const { repository, service } = setup();
    await repository.createDraft(record('draft'));
    await expect(service.deleteDraft('tenant-b', 'draft', 'client-a')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.deleteDraft('tenant-a', 'draft', 'client-b')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.deleteDraft('tenant-a', 'draft', 'client-a')).resolves.toEqual({ deleted: true });
    await expect(repository.get('tenant-a', 'draft')).resolves.toBeNull();
  });

  it('retains signed evidence and forbids deleting signed or voided contracts', async () => {
    const { repository, service } = setup();
    await repository.createDraft(record('signed', 'signed'));
    await expect(service.deleteDraft('tenant-a', 'signed', 'client-a')).rejects.toMatchObject({ statusCode: 409 });
    await expect(repository.get('tenant-a', 'signed')).resolves.not.toBeNull();
  });

  it('voids draft/signed idempotently and preserves evidence', async () => {
    const { repository, service } = setup();
    await repository.createDraft(record('one', 'signed'));
    const first = await service.void('tenant-a', 'one');
    const second = await service.void('tenant-a', 'one');
    expect(first.status).toBe('voided');
    expect(second).toEqual(first);
  });

  it('returns evidence tenant-scoped and portal status only when enabled', async () => {
    const { repository, service, deps } = setup();
    await repository.createDraft(record('one'));
    await repository.signApply({
      tenantId: 'tenant-a', contractId: 'one', documentId: 'doc-one', fileName: 'one.pdf',
      storagePath: 'tenant-a/client-a/doc-one-one.pdf', mimeType: 'application/pdf', pdfSha256: 'b'.repeat(64),
      witnessUserId: 'staff', witnessRole: 'tecnico', signerIp: null, userAgent: null, geo: null,
      signedAt: '2026-08-09T12:00:00.000Z',
    });
    await expect(service.getEvidence('tenant-b', 'one')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getEvidence('tenant-a', 'one')).resolves.toMatchObject({ witnessUserId: 'staff' });
    await expect(service.getPortalStatus('tenant-a', 'client-a')).resolves.toEqual({ status: 'signed', signedAt: '2026-08-09T12:00:00.000Z' });
    vi.mocked(deps.templates.getTemplate).mockResolvedValue({ configured: true, showInPortal: false } as never);
    await expect(service.getPortalStatus('tenant-a', 'client-a')).resolves.toBeNull();
  });
});
