import { describe, it, expect } from 'vitest';
import type { PlanRecord } from '../../backend/domains/plans/mappers';
import {
  PlanRow,
  planPatchToRow,
  planToRow,
  rowToPlan,
} from '../../backend/domains/plans/mappers';

const fullRow: PlanRow = {
  id: 'plan-basic',
  name: 'Nuga Residencial 20M',
  speed_down_mbps: 20,
  speed_up_mbps: 5,
  price: 299,
  tech_type: 'PPPoE',
  business_type: 'Residencial',
  is_active: true,
};

describe('plans mappers', () => {
  it('rowToPlan mapea snake_case -> camelCase y conserva valores de enum', () => {
    const plan = rowToPlan(fullRow);
    expect(plan.id).toBe('plan-basic');
    expect(plan.name).toBe('Nuga Residencial 20M');
    expect(plan.speedMbpsDown).toBe(20);
    expect(plan.speedMbpsUp).toBe(5);
    expect(plan.price).toBe(299);
    expect(plan.type).toBe('PPPoE'); // enum técnico NO traducido
    expect(plan.businessType).toBe('Residencial'); // enum negocio NO traducido
    expect(plan.isActive).toBe(true);
  });

  it('rowToPlan normaliza price NUMERIC entregado como string a number', () => {
    const plan = rowToPlan({ ...fullRow, price: '2499.00' });
    expect(plan.price).toBe(2499);
    expect(typeof plan.price).toBe('number');
  });

  it('planToRow es inverso de rowToPlan en los campos persistidos', () => {
    const plan = rowToPlan(fullRow);
    const row = planToRow(plan);
    expect(row.name).toBe(fullRow.name);
    expect(row.speed_down_mbps).toBe(fullRow.speed_down_mbps);
    expect(row.speed_up_mbps).toBe(fullRow.speed_up_mbps);
    expect(row.price).toBe(299);
    expect(row.tech_type).toBe(fullRow.tech_type);
    expect(row.business_type).toBe(fullRow.business_type);
    expect(row.is_active).toBe(fullRow.is_active);
  });

  it('planPatchToRow solo incluye claves presentes y traduce nombres', () => {
    const patch: Partial<PlanRecord> = { price: 350, isActive: false };
    const row = planPatchToRow(patch);
    expect(row).toEqual({ price: 350, is_active: false });
    expect(Object.keys(row)).toHaveLength(2);
  });

  it('planPatchToRow traduce speedMbpsDown/Up y businessType', () => {
    const patch: Partial<PlanRecord> = {
      speedMbpsDown: 100,
      speedMbpsUp: 50,
      businessType: 'Empresarial',
      type: 'Static',
    };
    const row = planPatchToRow(patch);
    expect(row).toEqual({
      speed_down_mbps: 100,
      speed_up_mbps: 50,
      business_type: 'Empresarial',
      tech_type: 'Static',
    });
  });

  it('planPatchToRow ignora claves desconocidas (id)', () => {
    const patch = { id: 'plan-9', name: 'Nuevo' } as unknown as Partial<PlanRecord>;
    const row = planPatchToRow(patch);
    expect(row).toEqual({ name: 'Nuevo' });
  });
});
