import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';
import { ContractService, setContractServiceForTests } from '../../backend/domains/contracts/service';

const roles = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'] as const;
const headers = (role: typeof roles[number]) => ({
  'x-user-role': role, 'x-user-id': `staff-${role}`, 'x-tenant-id': 'tenant-default',
});
const record = { id: 'contract-a', tenantId: 'tenant-default', clientId: 'client-a', status: 'draft' };

describe('Contracts API RBAC and request boundary', () => {
  const app = createApp();
  const service = {
    generate: vi.fn().mockResolvedValue(record),
    get: vi.fn().mockResolvedValue(record),
    deleteDraft: vi.fn().mockResolvedValue({ deleted: true }),
    getEvidence: vi.fn().mockResolvedValue({ contractId: 'contract-a' }),
    sign: vi.fn().mockResolvedValue({ contractId: 'contract-a', concurrentAttemptDiscarded: false }),
    void: vi.fn().mockResolvedValue({ ...record, status: 'voided' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setContractServiceForTests(service as unknown as ContractService);
  });

  it.each(roles)('%s puede leer contrato y evidencia', async (role) => {
    expect((await request(app).get('/api/clients/client-a/contracts/contract-a').set(headers(role))).status).toBe(200);
    expect((await request(app).get('/api/clients/client-a/contracts/contract-a/evidence').set(headers(role))).status).toBe(200);
  });

  it.each(roles)('aplica matriz exacta de crear/eliminar a %s', async (role) => {
    const expected = role === 'solo lectura' ? 403 : 201;
    expect((await request(app).post('/api/contracts').set(headers(role)).send({ clientId: 'client-a' })).status).toBe(expected);
    expect((await request(app).delete('/api/clients/client-a/contracts/contract-a').set(headers(role))).status)
      .toBe(role === 'solo lectura' ? 403 : 200);
  });

  it.each(roles)('aplica matriz exacta de firma a %s', async (role) => {
    const allowed = ['super admin', 'administrador', 'tecnico'].includes(role);
    const response = await request(app).post('/api/contracts/contract-a/sign').set(headers(role))
      .send({ signaturePng: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(response.status).toBe(allowed ? 200 : 403);
  });

  it.each(roles)('aplica matriz exacta de anulación a %s', async (role) => {
    const response = await request(app).post('/api/contracts/contract-a/void').set(headers(role)).send({});
    expect(response.status).toBe(['super admin', 'administrador'].includes(role) ? 200 : 403);
  });

  it('rechaza el body opaco por su límite propio antes del servicio', async () => {
    const response = await request(app).post('/api/contracts/contract-a/sign').set(headers('tecnico'))
      .send({ signaturePng: `data:image/png;base64,${'A'.repeat(90 * 1024)}` });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CONTRACT_SIGNATURE_BODY_TOO_LARGE');
    expect(service.sign).not.toHaveBeenCalled();
  });

});
