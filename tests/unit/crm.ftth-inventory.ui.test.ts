import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CRM alta — FTTH + inventario real', () => {
  const crm = readFileSync(resolve(__dirname, '../../src/components/CrmModule.tsx'), 'utf8');

  it('muestra sección FTTH NAP/PON al elegir fibra', () => {
    expect(crm).toContain('customer-ftth-assignment');
    expect(crm).toContain('NAP cercana');
    expect(crm).toContain('/api/naps');
  });

  it('permite reserva desde inventario o entrada manual', () => {
    expect(crm).toContain('Entrada manual');
    expect(crm).toContain('/api/inventory/customer-equipment/manual-reservations');
    expect(crm).not.toContain('Reserva interna/mock');
  });
});
