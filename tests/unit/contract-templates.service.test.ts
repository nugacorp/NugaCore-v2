import { beforeEach, describe, expect, it } from 'vitest';
import {
  ContractTemplateService,
  MemoryContractTemplateRepository,
} from '../../backend/domains/contract-templates/service';

describe('ContractTemplateService', () => {
  let repository: MemoryContractTemplateRepository;
  let service: ContractTemplateService;

  beforeEach(() => {
    repository = new MemoryContractTemplateRepository();
    service = new ContractTemplateService(repository);
  });

  it('devuelve la semilla fail-soft sin persistirla y la marca no revisada por abogado', async () => {
    const view = await service.getTemplate('tenant-seed');

    expect(view).toMatchObject({
      tenantId: 'tenant-seed',
      configured: false,
      version: 0,
      showInPortal: false,
      legalReviewStatus: 'not_reviewed',
    });
    expect(view.legalNotice).toMatch(/no ha sido revisada por un abogado/i);
    expect(view.clauses.length).toBeGreaterThan(0);
    expect(await repository.get('tenant-seed')).toBeNull();
  });

  it('crea la fila viva en versión 1 y conserva cláusulas desactivadas', async () => {
    const saved = await service.saveTemplate('tenant-a', {
      expectedVersion: 0,
      showInPortal: true,
      clauses: [
        { id: 'servicio', titulo: 'Servicio', cuerpo: 'Plan {{plan.nombre}}', activa: true },
        { id: 'opcional', titulo: 'Opcional', cuerpo: 'Texto futuro', activa: false },
      ],
    });

    expect(saved).toMatchObject({ tenantId: 'tenant-a', configured: true, version: 1, showInPortal: true });
    expect(saved.clauses[1]).toEqual({ id: 'opcional', titulo: 'Opcional', cuerpo: 'Texto futuro', activa: false });
  });

  it('acota cada lectura y escritura al tenant solicitado', async () => {
    await service.saveTemplate('tenant-a', {
      expectedVersion: 0,
      showInPortal: false,
      clauses: [{ id: 'privada', titulo: 'Privada', cuerpo: 'Sólo tenant A', activa: true }],
    });

    const tenantB = await service.getTemplate('tenant-b');
    const tenantA = await service.getTemplate('tenant-a');

    expect(tenantB).toMatchObject({ tenantId: 'tenant-b', configured: false, version: 0 });
    expect(JSON.stringify(tenantB)).not.toContain('Sólo tenant A');
    expect(tenantA.clauses[0].cuerpo).toBe('Sólo tenant A');
  });

  it('usa compare-and-swap: dos guardados con la misma versión no pierden incrementos', async () => {
    await service.saveTemplate('tenant-cas', {
      expectedVersion: 0,
      showInPortal: false,
      clauses: [{ id: 'base', titulo: 'Base', cuerpo: 'v1', activa: true }],
    });

    const first = await service.saveTemplate('tenant-cas', {
      expectedVersion: 1,
      showInPortal: false,
      clauses: [{ id: 'base', titulo: 'Base', cuerpo: 'v2-a', activa: true }],
    });
    await expect(service.saveTemplate('tenant-cas', {
      expectedVersion: 1,
      showInPortal: true,
      clauses: [{ id: 'base', titulo: 'Base', cuerpo: 'v2-b', activa: true }],
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONTRACT_TEMPLATE_VERSION_CONFLICT' });

    expect(first.version).toBe(2);
    expect((await service.getTemplate('tenant-cas')).version).toBe(2);
  });

  it('editar la plantilla no muta el snapshot/version que un draft ya congeló', async () => {
    const v1 = await service.saveTemplate('tenant-history', {
      expectedVersion: 0,
      showInPortal: false,
      clauses: [{ id: 'precio', titulo: 'Precio', cuerpo: 'Mensualidad {{precio}}', activa: true }],
    });
    const draftSnapshot = {
      templateVersion: v1.version,
      renderedClauses: structuredClone(v1.clauses),
    };

    await service.saveTemplate('tenant-history', {
      expectedVersion: 1,
      showInPortal: false,
      clauses: [{ id: 'precio', titulo: 'Precio', cuerpo: 'Nuevo precio {{precio}}', activa: true }],
    });

    expect(draftSnapshot).toEqual({
      templateVersion: 1,
      renderedClauses: [{ id: 'precio', titulo: 'Precio', cuerpo: 'Mensualidad {{precio}}', activa: true }],
    });
  });

  it('expone un catálogo de variables que incluye los tokens prometidos', () => {
    expect(service.listVariables()).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: '{{cliente.nombre}}' }),
      expect.objectContaining({ token: '{{plan.velocidad}}' }),
      expect.objectContaining({ token: '{{precio}}' }),
    ]));
  });
});
