import { describe, it, expect, beforeEach } from 'vitest';
import type { PlanRecord } from '../../backend/domains/plans/mappers';
import {
  PlanFilters,
  PlansRepository,
} from '../../backend/domains/plans/repository';
import { PlansService, asBusinessType, parsePlanTechType } from '../../backend/domains/plans/service';

// Repo falso en memoria para probar el service de forma aislada (sin Supabase).
class FakeRepo implements PlansRepository {
  plans: PlanRecord[] = [];
  clientsUsing: string[] = []; // ids de plan "en uso"
  private seq = 0;

  async list(filters: PlanFilters): Promise<PlanRecord[]> {
    return this.plans.filter((p) => (!filters.status || (filters.status === 'active' ? p.isActive : !p.isActive)));
  }
  async findById(id: string): Promise<PlanRecord | null> {
    return this.plans.find((p) => p.id === id) ?? null;
  }
  async findByName(name: string): Promise<PlanRecord | null> {
    const lower = name.trim().toLowerCase();
    return this.plans.find((p) => p.name.toLowerCase() === lower) ?? null;
  }
  async create(plan: PlanRecord): Promise<PlanRecord> {
    this.plans.push(plan);
    return plan;
  }
  async update(id: string, patch: Partial<PlanRecord>): Promise<PlanRecord | null> {
    const i = this.plans.findIndex((p) => p.id === id);
    if (i === -1) return null;
    this.plans[i] = { ...this.plans[i], ...patch };
    return this.plans[i];
  }
  async remove(id: string): Promise<boolean> {
    const before = this.plans.length;
    this.plans = this.plans.filter((p) => p.id !== id);
    return this.plans.length < before;
  }
  async isInUse(id: string): Promise<boolean> {
    return this.clientsUsing.includes(id);
  }
  async generateId(): Promise<string> {
    this.seq += 1;
    return `plan-${this.seq}`;
  }
}

const validBody = {
  name: 'Nuga Test 50M',
  speedMbpsDown: 50,
  speedMbpsUp: 10,
  price: 449,
  type: 'PPPoE',
};

describe('helpers de plans', () => {
  it('asBusinessType normaliza variantes y cae a Residencial', () => {
    expect(asBusinessType('empresarial')).toBe('Empresarial');
    expect(asBusinessType('DEDICADO')).toBe('Dedicado');
    expect(asBusinessType('residencial')).toBe('Residencial');
    expect(asBusinessType(undefined)).toBe('Residencial');
    expect(asBusinessType('cualquier-cosa')).toBe('Residencial');
  });

  it('parsePlanTechType normaliza a la forma canónica del enum', () => {
    expect(parsePlanTechType('pppoe')).toBe('PPPoE');
    expect(parsePlanTechType('STATIC')).toBe('Static');
    expect(parsePlanTechType('Hotspot')).toBe('Hotspot');
    expect(parsePlanTechType('dhcp')).toBe('DHCP');
    expect(parsePlanTechType('algo-raro')).toBeNull();
    expect(parsePlanTechType(undefined)).toBeNull();
  });
});

describe('PlansService (repo falso)', () => {
  let repo: FakeRepo;
  let service: PlansService;

  beforeEach(() => {
    repo = new FakeRepo();
    service = new PlansService(repo);
  });

  // --- validateCreate ---
  it('validateCreate acepta payload válido y aplica defaults', () => {
    const out = service.validateCreate(validBody);
    expect(out.name).toBe('Nuga Test 50M');
    expect(out.speedMbpsDown).toBe(50);
    expect(out.type).toBe('PPPoE');
    expect(out.businessType).toBe('Residencial'); // default
    expect(out.isActive).toBe(true); // default
  });

  it('validateCreate respeta businessType e isActive explícitos', () => {
    const out = service.validateCreate({ ...validBody, businessType: 'empresarial', isActive: false });
    expect(out.businessType).toBe('Empresarial');
    expect(out.isActive).toBe(false);
  });

  it('validateCreate rechaza campos faltantes', () => {
    expect(() => service.validateCreate({ name: 'X', speedMbpsDown: 10 })).toThrowError(/Missing required fields/);
    expect(() => service.validateCreate({ ...validBody, name: '   ' })).toThrowError(/Missing required fields/);
  });

  it('validateCreate rechaza precio negativo y velocidad negativa', () => {
    expect(() => service.validateCreate({ ...validBody, price: -1 })).toThrowError(/price/);
    expect(() => service.validateCreate({ ...validBody, speedMbpsDown: -5 })).toThrowError(/speedMbpsDown/);
    expect(() => service.validateCreate({ ...validBody, speedMbpsUp: -2 })).toThrowError(/speedMbpsUp/);
  });

  it('validateCreate rechaza precio/velocidad no numéricos', () => {
    expect(() => service.validateCreate({ ...validBody, price: 'gratis' })).toThrowError(/must be a number/);
  });

  it('validateCreate rechaza tipo técnico inválido', () => {
    expect(() => service.validateCreate({ ...validBody, type: 'fibra-magica' })).toThrowError(/Invalid plan type/);
  });

  // --- buildUpdatePatch ---
  it('buildUpdatePatch solo incluye claves presentes (coercionadas)', () => {
    const patch = service.buildUpdatePatch({ price: '350', isActive: 0 });
    expect(patch).toEqual({ price: 350, isActive: false });
  });

  it('buildUpdatePatch normaliza type y businessType', () => {
    const patch = service.buildUpdatePatch({ type: 'static', businessType: 'dedicado' });
    expect(patch).toEqual({ type: 'Static', businessType: 'Dedicado' });
  });

  it('buildUpdatePatch rechaza valores inválidos', () => {
    expect(() => service.buildUpdatePatch({ price: -10 })).toThrowError(/price/);
    expect(() => service.buildUpdatePatch({ type: 'xyz' })).toThrowError(/Invalid plan type/);
    expect(() => service.buildUpdatePatch({ name: '' })).toThrowError(/must not be empty/);
  });

  // --- assertNameAvailable ---
  it('assertNameAvailable lanza 409 si el nombre ya existe (case-insensitive)', async () => {
    await service.create({ id: 'plan-1', ...service.validateCreate(validBody) });
    await expect(service.assertNameAvailable('nuga test 50m')).rejects.toThrowError(/already exists/);
    await expect(service.assertNameAvailable('Otro Nombre')).resolves.toBeUndefined();
  });

  // --- delegaciones ---
  it('create + getById + list delegan en el repo', async () => {
    const record: PlanRecord = { id: await service.generatePlanId(), ...service.validateCreate(validBody) };
    await service.create(record);
    expect(await service.getById(record.id)).not.toBeNull();
    expect((await service.list({})).length).toBe(1);
  });

  it('update aplica el patch', async () => {
    await service.create({ id: 'plan-1', ...service.validateCreate(validBody) });
    const updated = await service.update('plan-1', service.buildUpdatePatch({ isActive: false, price: 500 }));
    expect(updated?.isActive).toBe(false);
    expect(updated?.price).toBe(500);
  });

  it('isInUse delega en el repo', async () => {
    repo.clientsUsing = ['plan-1'];
    expect(await service.isInUse('plan-1')).toBe(true);
    expect(await service.isInUse('plan-2')).toBe(false);
  });

  it('remove elimina el plan', async () => {
    await service.create({ id: 'plan-1', ...service.validateCreate(validBody) });
    expect(await service.remove('plan-1')).toBe(true);
    expect(await service.getById('plan-1')).toBeNull();
    expect(await service.remove('plan-1')).toBe(false);
  });

  it('generatePlanId delega en el repo', async () => {
    expect(await service.generatePlanId()).toBe('plan-1');
    expect(await service.generatePlanId()).toBe('plan-2');
  });
});
