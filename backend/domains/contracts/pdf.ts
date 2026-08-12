import PDFDocument from 'pdfkit';
import type { AppRole } from '../../common/rbac';
import type { ContractRecord } from './types';

export class PdfKitContractRenderer {
  async renderSignedContract(input: {
    contract: ContractRecord;
    signaturePng: Buffer;
    witness: { userId: string; role: AppRole };
  }): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const document = new PDFDocument({ size: 'LETTER', margins: { top: 54, right: 54, bottom: 54, left: 54 } });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      try {
        document.fontSize(18).text('Contrato de prestación de servicios', { align: 'center' });
        document.moveDown();
        for (const clause of input.contract.renderedClauses) {
          document.fontSize(12).font('Helvetica-Bold').text(clause.titulo);
          document.fontSize(10).font('Helvetica').text(clause.cuerpo, { align: 'justify' });
          document.moveDown();
        }
        document.addPage();
        document.fontSize(12).font('Helvetica-Bold').text('Firma del titular');
        document.moveDown(0.5);
        document.image(input.signaturePng, { fit: [260, 120] });
        document.moveDown();
        document.fontSize(9).font('Helvetica').text(`Testigo: ${input.witness.userId} (${input.witness.role})`);
        document.text(`Contrato: ${input.contract.id} · Plantilla v${input.contract.templateVersion}`);
        document.end();
      } catch (error) {
        document.destroy();
        reject(error);
      }
    });
  }
}
