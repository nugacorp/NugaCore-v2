import { describe, expect, it } from 'vitest';

import { classifyActiveSuspension } from '../../backend/domains/suspension/classification';
import type { CustomerSuspensionBlock } from '../../backend/domains/suspension/types';

const block = (category: CustomerSuspensionBlock['category']): CustomerSuspensionBlock => ({
  id: `block-${category}`,
  tenantId: 'tenant-classification',
  customerId: 'customer-classification',
  category,
  source: category === 'financial' ? 'billing' : 'manual',
  reason: `${category} fixture`,
  evidenceType: 'test',
  evidenceId: `evidence-${category}`,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

describe('automatic payment reactivation suspension classification', () => {
  it('clasifica financial, non_financial, unknown y none desde bloques activos', () => {
    expect(classifyActiveSuspension({ status: 'suspended' }, [block('financial')]).blockReasonCategory)
      .toBe('financial');
    expect(classifyActiveSuspension({ status: 'suspended' }, [block('non_financial')]).blockReasonCategory)
      .toBe('non_financial');
    expect(classifyActiveSuspension({ status: 'suspended' }, [block('unknown')]).blockReasonCategory)
      .toBe('unknown');
    expect(classifyActiveSuspension({ status: 'active' }, []).blockReasonCategory)
      .toBe('none');
  });

  it('unknown y non_financial dominan sobre financial cuando hay multiples bloqueos', () => {
    expect(classifyActiveSuspension({ status: 'suspended' }, [block('financial'), block('non_financial')])
      .blockReasonCategory).toBe('non_financial');
    expect(classifyActiveSuspension({ status: 'suspended' }, [block('financial'), block('unknown')])
      .blockReasonCategory).toBe('unknown');
  });

  it('customer.status=suspended sin bloque estructurado nunca implica financial', () => {
    const result = classifyActiveSuspension({ status: 'suspended' }, []);

    expect(result.blockReasonCategory).toBe('unknown');
    expect(result.reason).toMatch(/falla cerrado/i);
  });
});
