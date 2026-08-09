import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContractService,
  MemoryContractsRepository,
  type ContractServiceDependencies,
} from '../../backend/domains/contracts/service';
import type { ContractRecord } from '../../backend/domains/contracts/types';

const tenantId = 'tenant-a';
const signatureBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const signaturePng = `data:image/png;base64,${signatureBytes.toString('base64')}`;
const pdfBytes = Buffer.from('%PDF-signed-contract-bytes');

const draft = (): ContractRecord => ({
  id: 'contract-a',
  tenantId,
  clientId: 'client-a',
  templateVersion: 3,
  renderedClauses: [{ id: 'servicio', titulo: 'Servicio', cuerpo: 'Texto congelado', activa: true }],
  renderedText: 'Servicio\nTexto congelado',
  status: 'draft',
  documentId: null,
  pdfSha256: null,
  signedAt: null,
  voidedAt: null,
  createdAt: '2026-08-09T12:00:00.000Z',
  updatedAt: '2026-08-09T12:00:00.000Z',
});

const setup = async () => {
  const repository = new MemoryContractsRepository();
  await repository.createDraft(draft());
  const deps: ContractServiceDependencies = {
    repository,
    templates: { getTemplate: vi.fn() },
    customers: { getById: vi.fn() },
    plans: { getById: vi.fn() },
    tenants: { getTenant: vi.fn() },
    pdf: { renderSignedContract: vi.fn().mockResolvedValue(pdfBytes) },
    storage: {
      upload: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(true),
    },
    id: vi.fn().mockReturnValue('document-attempt-a'),
    now: vi.fn().mockReturnValue(new Date('2026-08-09T12:30:00.000Z')),
  };
  return { repository, deps, service: new ContractService(deps) };
};

const witness = (userId = 'tech-a') => ({
  userId,
  role: 'tecnico' as const,
  signerIp: '192.0.2.20',
  userAgent: 'NugaCore Tech PWA',
});

describe('ContractService signing', () => {
  let repository: MemoryContractsRepository;
  let deps: ContractServiceDependencies;
  let service: ContractService;

  beforeEach(async () => {
    ({ repository, deps, service } = await setup());
  });

  it('sube el PDF firmado y guarda el SHA-256 de exactamente esos bytes mediante la RPC', async () => {
    const result = await service.sign(tenantId, 'contract-a', {
      signaturePng,
      geo: { latitude: 32.5, longitude: -117.0, accuracy: 12 },
    }, witness());

    const upload = vi.mocked(deps.storage.upload).mock.calls[0];
    expect(upload[0]).toMatch(/^tenant-a\/client-a\/document-attempt-a-/);
    expect(upload[0]).toMatch(/\.pdf$/);
    expect(upload[1]).toBe(pdfBytes);
    expect(upload[2]).toBe('application/pdf');
    expect(result).toMatchObject({
      contractId: 'contract-a',
      documentId: 'document-attempt-a',
      pdfSha256: createHash('sha256').update(upload[1]).digest('hex'),
      alreadySigned: false,
      concurrentAttemptDiscarded: false,
    });
    expect(await repository.get(tenantId, 'contract-a')).toMatchObject({
      status: 'signed',
      documentId: 'document-attempt-a',
      pdfSha256: result.pdfSha256,
    });
    expect(await repository.getEvidence(tenantId, 'contract-a')).toMatchObject({
      witnessUserId: 'tech-a',
      witnessRole: 'tecnico',
      signerIp: '192.0.2.20',
      userAgent: 'NugaCore Tech PWA',
      geo: { latitude: 32.5, longitude: -117, accuracy: 12 },
    });
    expect(JSON.stringify(result)).not.toContain(signaturePng);
    expect(result).not.toHaveProperty('storagePath');
  });

  it.each([
    [null],
    [{}],
    [{ signaturePng: 7 }],
    [{ signaturePng: 'not-a-data-url' }],
    [{ signaturePng: 'data:image/jpeg;base64,AAAA' }],
    [{ signaturePng: 'data:image/png;base64,AAAA' }],
    [{ signaturePng, storagePath: 'tenant-b/client-b/stolen.pdf' }],
    [{ signaturePng, pdfSha256: 'a'.repeat(64) }],
    [{ signaturePng, geo: { latitude: '32', longitude: -117 } }],
    [{ signaturePng, geo: { latitude: 91, longitude: -117 } }],
    [{ signaturePng, geo: { latitude: 32, longitude: -181 } }],
    [{ signaturePng, geo: { latitude: 32, longitude: -117, accuracy: -1 } }],
  ])('rechaza firma/geo/campos sensibles no estrictos antes de efectos: %j', async (input) => {
    await expect(service.sign(tenantId, 'contract-a', input, witness())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(deps.pdf.renderSignedContract).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });

  it('rechaza una firma que excede su tope declarado antes de renderizar', async () => {
    const tooLarge = Buffer.concat([signatureBytes, Buffer.alloc(48 * 1024)]);
    const dataUrl = `data:image/png;base64,${tooLarge.toString('base64')}`;

    await expect(service.sign(tenantId, 'contract-a', { signaturePng: dataUrl }, witness()))
      .rejects.toMatchObject({ statusCode: 400, code: 'CONTRACT_SIGNATURE_TOO_LARGE' });
    expect(deps.pdf.renderSignedContract).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });

  it('exige testigo identificado antes de renderizar', async () => {
    await expect(service.sign(tenantId, 'contract-a', { signaturePng }, {
      ...witness(),
      userId: '',
    })).rejects.toMatchObject({ statusCode: 400, code: 'CONTRACT_WITNESS_REQUIRED' });
    expect(deps.pdf.renderSignedContract).not.toHaveBeenCalled();
  });

  it('si upload falla no llama a RPC y compensa sólo la ruta propia del intento', async () => {
    vi.mocked(deps.storage.upload).mockRejectedValue(new Error('storage unavailable'));
    const signApply = vi.spyOn(repository, 'signApply');

    await expect(service.sign(tenantId, 'contract-a', { signaturePng }, witness())).rejects.toThrow('storage unavailable');

    const attemptedPath = vi.mocked(deps.storage.upload).mock.calls[0][0];
    expect(signApply).not.toHaveBeenCalled();
    expect(deps.storage.remove).toHaveBeenCalledWith(attemptedPath);
    expect((await repository.get(tenantId, 'contract-a'))?.status).toBe('draft');
  });

  it('si RPC falla después del upload compensa su objeto y conserva draft', async () => {
    vi.spyOn(repository, 'signApply').mockRejectedValue(new Error('rpc unavailable'));

    await expect(service.sign(tenantId, 'contract-a', { signaturePng }, witness())).rejects.toThrow('rpc unavailable');

    const attemptedPath = vi.mocked(deps.storage.upload).mock.calls[0][0];
    expect(deps.storage.remove).toHaveBeenCalledWith(attemptedPath);
    expect((await repository.get(tenantId, 'contract-a'))?.status).toBe('draft');
  });

  it('redelivery devuelve el mismo documento/hash y conserva el primer testigo sin volver a subir', async () => {
    const first = await service.sign(tenantId, 'contract-a', { signaturePng }, witness('tech-first'));
    vi.clearAllMocks();

    const second = await service.sign(tenantId, 'contract-a', { signaturePng }, witness('tech-second'));

    expect(second).toMatchObject({
      documentId: first.documentId,
      pdfSha256: first.pdfSha256,
      alreadySigned: true,
      concurrentAttemptDiscarded: false,
    });
    expect(deps.pdf.renderSignedContract).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
    expect((await repository.getEvidence(tenantId, 'contract-a'))?.witnessUserId).toBe('tech-first');
  });

  it('el perdedor concurrente elimina sólo su objeto y devuelve documento/hash del ganador', async () => {
    const winningHash = 'b'.repeat(64);
    vi.spyOn(repository, 'signApply').mockResolvedValue({
      contractId: 'contract-a',
      clientId: 'client-a',
      documentId: 'document-winner',
      pdfSha256: winningHash,
      signedAt: '2026-08-09T12:29:00.000Z',
      alreadySigned: true,
      voidedContractIds: [],
    });

    const result = await service.sign(tenantId, 'contract-a', { signaturePng }, witness('tech-loser'));

    const losingPath = vi.mocked(deps.storage.upload).mock.calls[0][0];
    expect(result).toMatchObject({
      documentId: 'document-winner',
      pdfSha256: winningHash,
      alreadySigned: true,
      concurrentAttemptDiscarded: true,
    });
    expect(deps.storage.remove).toHaveBeenCalledTimes(1);
    expect(deps.storage.remove).toHaveBeenCalledWith(losingPath);
    expect(losingPath).not.toContain('document-winner');
  });
});
