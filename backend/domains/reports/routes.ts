import { Router } from 'express';
import * as XLSX from 'xlsx';
import { asyncHandler } from '../../common/errors';
import { requireAction } from '../../common/rbac';
import { buildFinancialRows, buildOperationalRows, buildRowsByScope, buildSecurityRows } from './service';

const router = Router();

type ReportScope = 'financial' | 'operational' | 'security';
type ReportFormat = 'csv' | 'xlsx' | 'pdf';

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

const parseScope = (value: unknown): ReportScope | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'financial') return 'financial';
  if (normalized === 'operational') return 'operational';
  if (normalized === 'security') return 'security';
  return null;
};

const parseFormat = (value: unknown): ReportFormat | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'csv') return 'csv';
  if (normalized === 'xlsx') return 'xlsx';
  if (normalized === 'pdf') return 'pdf';
  return null;
};

const toCsv = (rows: Record<string, unknown>[]): string => {
  if (rows.length === 0) return 'no_data\n';
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: unknown): string => {
    const raw = value === null || value === undefined ? '' : String(value);
    if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  }
  return lines.join('\n');
};

const escapePdfText = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const toPdfBuffer = (title: string, lines: string[]): Buffer => {
  const safeLines = [title, ''].concat(lines).slice(0, 50);
  const streamLines = ['BT', '/F1 12 Tf', '50 790 Td'];

  safeLines.forEach((line, index) => {
    const text = `(${escapePdfText(line)}) Tj`;
    if (index === 0) {
      streamLines.push(text);
    } else {
      streamLines.push('T*');
      streamLines.push(text);
    }
  });
  streamLines.push('ET');

  const contentStream = streamLines.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, 'utf8');
};

router.get('/api/reports/catalog', requireAction('reports.view'), (_req, res) => {
  res.json({
    scopes: ['financial', 'operational', 'security'],
    formats: ['csv', 'xlsx', 'pdf'],
    generatedAt: nowStamp(),
    source: 'ssot-services',
  });
});

router.get('/api/reports/summary', requireAction('reports.view'), asyncHandler(async (_req, res) => {
  const [financial, operational, security] = await Promise.all([
    buildFinancialRows(),
    buildOperationalRows(),
    Promise.resolve(buildSecurityRows()),
  ]);

  res.json({
    generatedAt: nowStamp(),
    totals: {
      financialRows: financial.length,
      operationalRows: operational.length,
      securityRows: security.length,
    },
    previews: {
      financial: financial.slice(0, 3),
      operational: operational.slice(0, 3),
      security: security.slice(0, 3),
    },
  });
}));

router.get('/api/reports/export', requireAction('reports.export'), asyncHandler(async (req, res) => {
  const scope = parseScope(req.query.scope);
  const format = parseFormat(req.query.format);

  if (!scope) {
    return res.status(400).json({ error: 'Invalid scope. Allowed: financial, operational, security.' });
  }
  if (!format) {
    return res.status(400).json({ error: 'Invalid format. Allowed: csv, xlsx, pdf.' });
  }

  const rows = await buildRowsByScope(scope);
  const fileBase = `nugacore-${scope}-${new Date().toISOString().substring(0, 10)}`;

  if (format === 'csv') {
    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    return res.send(csv);
  }

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, scope.toUpperCase());
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.send(buffer);
  }

  const previewLines = rows.slice(0, 20).map((row, index) => `${index + 1}. ${Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
  const pdfBuffer = toPdfBuffer(`Reporte ${scope.toUpperCase()} - ${nowStamp()}`, previewLines);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
  return res.send(pdfBuffer);
}));

export default router;
