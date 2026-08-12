import { describe, expect, it } from 'vitest';
import { PdfKitContractRenderer } from '../../backend/domains/contracts/pdf';
import type { ContractRecord } from '../../backend/domains/contracts/types';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

describe('PdfKitContractRenderer', () => {
  it('renders the frozen clauses and embeds a PNG signature into PDF bytes', async () => {
    const contract: ContractRecord = {
      id: 'contract-a', tenantId: 'tenant-a', clientId: 'client-a', templateVersion: 4,
      renderedClauses: [{ id: 'one', titulo: 'Servicio', cuerpo: 'Texto final sin variables', activa: true }],
      renderedText: 'Servicio\nTexto final sin variables', status: 'draft', documentId: null,
      pdfSha256: null, signedAt: null, voidedAt: null,
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
    };
    const bytes = await new PdfKitContractRenderer().renderSignedContract({
      contract, signaturePng: PNG, witness: { userId: 'staff-a', role: 'tecnico' },
    });
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(500);
  });
});
