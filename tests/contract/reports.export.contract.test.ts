import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'reports-test-admin' };

const binaryParser = (
  res: NodeJS.EventEmitter,
  callback: (error: Error | null, body: Buffer) => void,
): void => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Reports export', () => {
  it('exports XLSX without the vulnerable SheetJS runtime dependency', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/reports/export?scope=financial&format=xlsx')
      .set(ADMIN)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 2).toString('utf8')).toBe('PK');
  });
});
