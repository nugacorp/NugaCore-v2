import type { CustomerLite } from './data-provider';
import type { CustomerSuspensionBlock, SuspensionBlockCategory } from './types';

export type SuspensionBlockReasonCategory = SuspensionBlockCategory | 'none';

export interface SuspensionClassification {
  blockReasonCategory: SuspensionBlockReasonCategory;
  activeBlocks: CustomerSuspensionBlock[];
  reason: string;
}

export function classifyActiveSuspension(
  customer: Pick<CustomerLite, 'status'> | null | undefined,
  activeBlocks: CustomerSuspensionBlock[],
): SuspensionClassification {
  const categories = new Set(activeBlocks.map((block) => block.category));

  if (categories.has('unknown')) {
    return {
      blockReasonCategory: 'unknown',
      activeBlocks,
      reason: 'Existe bloqueo activo de clasificacion desconocida.',
    };
  }

  if (categories.has('non_financial')) {
    return {
      blockReasonCategory: 'non_financial',
      activeBlocks,
      reason: 'Existe bloqueo activo no financiero.',
    };
  }

  if (categories.has('financial')) {
    return {
      blockReasonCategory: 'financial',
      activeBlocks,
      reason: 'Solo hay bloqueos financieros activos.',
    };
  }

  if (customer?.status === 'suspended') {
    return {
      blockReasonCategory: 'unknown',
      activeBlocks,
      reason: 'Cliente suspendido sin evidencia activa estructurada; falla cerrado.',
    };
  }

  return {
    blockReasonCategory: 'none',
    activeBlocks,
    reason: 'No hay bloqueos activos estructurados.',
  };
}
