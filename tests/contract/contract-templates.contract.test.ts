import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';
import { resetContractTemplateService } from '../../backend/domains/contract-templates/service';

const roles = [
  'super admin',
  'administrador',
  'cobranza',
  'tecnico',
  'soporte',
  'solo lectura',
] as const;
const writeRoles = ['super admin', 'administrador'] as const;
const blockedWriteRoles = ['cobranza', 'tecnico', 'soporte', 'solo lectura'] as const;

const headers = (role: typeof roles[number]) => ({
  'x-user-role': role,
  'x-user-id': `contract-template-${role}`,
  'x-tenant-id': 'tenant-default',
});

const body = (expectedVersion: number, text = 'Servicio {{plan.velocidad}}') => ({
  expectedVersion,
  showInPortal: true,
  clauses: [{ id: 'servicio', titulo: 'Servicio', cuerpo: text, activa: true }],
});

describe('Contract templates API', () => {
  const app = createApp();

  beforeEach(() => resetContractTemplateService());

  it.each(roles)('%s puede leer la plantilla y el catálogo', async (role) => {
    const template = await request(app).get('/api/contract-template').set(headers(role));
    const variables = await request(app).get('/api/contract-template/variables').set(headers(role));

    expect(template.status).toBe(200);
    expect(variables.status).toBe(200);
    expect(Array.isArray(variables.body.variables)).toBe(true);
  });

  it.each(writeRoles)('%s puede guardar la plantilla', async (role) => {
    const response = await request(app)
      .put('/api/contract-template')
      .set(headers(role))
      .send(body(0));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ configured: true, version: 1, showInPortal: true });
  });

  it.each(blockedWriteRoles)('%s recibe 403 al guardar', async (role) => {
    const response = await request(app)
      .put('/api/contract-template')
      .set(headers(role))
      .send(body(0));

    expect(response.status).toBe(403);
  });

  it('rechaza un guardado obsoleto con 409 y conserva la versión vigente', async () => {
    const adminHeaders = headers('super admin');
    expect((await request(app).put('/api/contract-template').set(adminHeaders).send(body(0))).status).toBe(200);
    expect((await request(app).put('/api/contract-template').set(adminHeaders).send(body(1, 'v2'))).status).toBe(200);

    const stale = await request(app).put('/api/contract-template').set(adminHeaders).send(body(1, 'stale'));
    const current = await request(app).get('/api/contract-template').set(adminHeaders);

    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONTRACT_TEMPLATE_VERSION_CONFLICT');
    expect(current.body.version).toBe(2);
    expect(current.body.clauses[0]).toEqual({ id: 'servicio', titulo: 'Servicio', cuerpo: 'v2', activa: true });
  });
});
