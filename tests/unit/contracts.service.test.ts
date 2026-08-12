import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContractService,
  MemoryContractsRepository,
  type ContractServiceDependencies,
} from '../../backend/domains/contracts/service';
import type { ContractTemplateView } from '../../backend/domains/contract-templates/types';
import type { Client, Plan } from '../../src/types';

const tenantId = 'tenant-a';
const client: Client = {
  id: 'client-a',
  tenantId,
  name: 'María López',
  type: 'residential',
  status: 'active',
  email: 'maria@example.test',
  phone: '5550000000',
  address: 'Av. Reforma 100',
  city: 'Tijuana',
  lat: 32.5,
  lng: -117,
  planId: 'plan-a',
  ip: '192.0.2.10',
};
const plan: Plan = {
  id: 'plan-a',
  tenantId,
  name: 'Fibra 100',
  speedMbpsDown: 100,
  speedMbpsUp: 50,
  price: 499,
  type: 'PPPoE',
};

const template = (version = 3): ContractTemplateView => ({
  tenantId,
  configured: true,
  version,
  showInPortal: true,
  legalReviewStatus: 'tenant_managed',
  updatedAt: '2026-08-09T00:00:00.000Z',
  clauses: [
    {
      id: 'servicio',
      titulo: 'Servicio',
      cuerpo: '{{cliente.nombre}} contrata {{plan.nombre}} ({{plan.velocidad}}) por {{precio}} con {{wisp.nombre}} en {{cliente.direccion}} el {{fecha.contrato}}.',
      activa: true,
    },
  ],
});

const dependencies = (): ContractServiceDependencies => ({
  repository: new MemoryContractsRepository(),
  templates: { getTemplate: vi.fn().mockResolvedValue(template()) },
  customers: { getById: vi.fn().mockResolvedValue(client) },
  plans: { getById: vi.fn().mockResolvedValue(plan) },
  tenants: { getTenant: vi.fn().mockResolvedValue({ id: tenantId, name: 'Red Ejemplo' }) },
  pdf: { renderSignedContract: vi.fn() },
  storage: { upload: vi.fn(), remove: vi.fn() },
  id: vi.fn()
    .mockReturnValueOnce('contract-generated')
    .mockReturnValueOnce('document-generated'),
  now: vi.fn().mockReturnValue(new Date('2026-08-09T12:00:00.000Z')),
});

describe('ContractService', () => {
  let deps: ContractServiceDependencies;
  let service: ContractService;

  beforeEach(() => {
    deps = dependencies();
    service = new ContractService(deps);
  });

  it('genera un draft tenant-scoped con cláusulas y versión congeladas, sin variables pendientes', async () => {
    const draft = await service.generate(tenantId, { clientId: client.id });

    expect(draft).toMatchObject({
      id: 'contract-generated',
      tenantId,
      clientId: client.id,
      templateVersion: 3,
      status: 'draft',
      documentId: null,
      pdfSha256: null,
    });
    expect(draft.renderedClauses[0].cuerpo).toContain('María López');
    expect(draft.renderedClauses[0].cuerpo).toContain('Fibra 100');
    expect(draft.renderedClauses[0].cuerpo).toContain('Red Ejemplo');
    expect(JSON.stringify(draft.renderedClauses)).not.toMatch(/{{|}}/);
    expect(draft.renderedText).toContain('Servicio');
  });

  it('editar la plantilla después no altera el snapshot del draft', async () => {
    const draft = await service.generate(tenantId, { clientId: client.id });
    vi.mocked(deps.templates.getTemplate).mockResolvedValue(template(4));
    template(4).clauses[0].cuerpo = 'Texto nuevo';

    const frozen = await service.get(tenantId, draft.id, client.id);

    expect(frozen.templateVersion).toBe(3);
    expect(frozen.renderedClauses[0].cuerpo).toContain('María López');
  });

  it('falla cerrado si la plantilla no está configurada', async () => {
    vi.mocked(deps.templates.getTemplate).mockResolvedValue({ ...template(), configured: false, version: 0 });

    await expect(service.generate(tenantId, { clientId: client.id })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONTRACT_TEMPLATE_NOT_CONFIGURED',
    });
  });

  it('no genera si falta un dato exigido por una variable', async () => {
    const withRfc = template();
    withRfc.clauses[0].cuerpo = 'RFC {{cliente.rfc}}';
    vi.mocked(deps.templates.getTemplate).mockResolvedValue(withRfc);

    await expect(service.generate(tenantId, { clientId: client.id })).rejects.toMatchObject({
      statusCode: 400,
      code: 'CONTRACT_VARIABLE_DATA_MISSING',
    });
    expect(await deps.repository.get(tenantId, 'contract-generated')).toBeNull();
  });

  it('no filtra ni acepta clientes de otro tenant', async () => {
    vi.mocked(deps.customers.getById).mockResolvedValue(null);

    await expect(service.generate(tenantId, { clientId: 'client-b' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONTRACT_CLIENT_NOT_FOUND',
    });
    expect(deps.customers.getById).toHaveBeenCalledWith('client-b', tenantId);
  });

  it('rechaza leads después de validar tenant y antes de cualquier efecto', async () => {
    vi.mocked(deps.customers.getById).mockResolvedValue({ ...client, status: 'lead' });
    const createDraft = vi.spyOn(deps.repository, 'createDraft');

    await expect(service.generate(tenantId, { clientId: client.id })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONTRACT_LEAD_NOT_ALLOWED',
    });

    expect(deps.customers.getById).toHaveBeenCalledWith(client.id, tenantId);
    expect(deps.templates.getTemplate).not.toHaveBeenCalled();
    expect(deps.plans.getById).not.toHaveBeenCalled();
    expect(deps.tenants.getTenant).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
    expect(deps.pdf.renderSignedContract).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
    expect(deps.storage.remove).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { clientId: 7 },
    { clientId: '' },
    { clientId: 'client-a', storagePath: 'tenant-b/secret.pdf' },
  ])('rechaza payload de generación no estricto: %j', async (input) => {
    await expect(service.generate(tenantId, input)).rejects.toMatchObject({ statusCode: 400 });
  });
});
