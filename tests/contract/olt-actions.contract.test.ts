import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const ADMIN = { 'x-user-role': 'administrador', 'x-user-id': 'olt-admin' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'olt-reader' };

const PROVISION_PAYLOAD = {
  serial: '48575443A1B2C3D4',
  ponPort: '0/1/0',
  onuIndex: 5,
  vlan: 100,
  description: 'Cliente demo',
};

describe('Cola de acciones OLT', () => {
  let app: Express;
  let oltId: string;

  beforeAll(async () => {
    app = createApp();
    const created = await request(app)
      .post('/api/olts')
      .set(ADMIN)
      .send({ name: 'OLT Lab', brand: 'Huawei', model: 'MA5608T', managementIp: '10.10.0.2' });
    expect(created.status).toBe(201);
    oltId = created.body.id;
  });

  it('encola una autorización de ONU con el plan de comandos de la marca', async () => {
    const res = await request(app)
      .post('/api/olt-actions')
      .set(ADMIN)
      .send({ oltId, actionType: 'provision_onu', payload: PROVISION_PAYLOAD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      oltId,
      actionType: 'provision_onu',
      status: 'pending',
      cliFlavor: 'huawei',
      attempts: 0,
    });
    expect(res.body.plannedCommands.join('\n')).toContain('sn-auth "48575443A1B2C3D4"');
  });

  it('NUNCA encola con ejecución habilitada mientras no haya driver validado', async () => {
    const res = await request(app)
      .post('/api/olt-actions')
      .set(ADMIN)
      // Aunque el cliente pida ejecución real, el servicio la ignora.
      .send({ oltId, actionType: 'reboot_onu', dryRun: false, payload: PROVISION_PAYLOAD });

    expect(res.status).toBe(201);
    expect(res.body.dryRun).toBe(true);

    const list = await request(app).get('/api/olt-actions').set(READER);
    expect(list.status).toBe(200);
    expect(list.body.executionEnabled).toBe(false);
    expect(list.body.actions.every((a: { dryRun: boolean }) => a.dryRun)).toBe(true);
  });

  it('rechaza acciones contra una OLT inexistente', async () => {
    const res = await request(app)
      .post('/api/olt-actions')
      .set(ADMIN)
      .send({ oltId: 'olt-fantasma', actionType: 'provision_onu', payload: PROVISION_PAYLOAD });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('OLT_NOT_FOUND');
  });

  it('valida el tipo de acción y el oltId', async () => {
    await request(app)
      .post('/api/olt-actions')
      .set(ADMIN)
      .send({ oltId, actionType: 'drop_database' })
      .expect(400);
    await request(app)
      .post('/api/olt-actions')
      .set(ADMIN)
      .send({ actionType: 'provision_onu' })
      .expect(400);
  });

  it('un rol de solo lectura no puede encolar', async () => {
    const res = await request(app)
      .post('/api/olt-actions')
      .set(READER)
      .send({ oltId, actionType: 'provision_onu', payload: PROVISION_PAYLOAD });
    expect(res.status).toBe(403);
  });

  it('filtra por OLT y cancela una acción pendiente', async () => {
    const created = await request(app)
      .post('/api/olt-actions')
      .set(ADMIN)
      .send({ oltId, actionType: 'suspend_onu', payload: PROVISION_PAYLOAD });
    const id = created.body.id;

    const filtered = await request(app).get('/api/olt-actions').query({ oltId }).set(READER);
    expect(filtered.body.actions.some((a: { id: string }) => a.id === id)).toBe(true);

    const cancelled = await request(app)
      .post(`/api/olt-actions/${id}/cancel`)
      .set(ADMIN)
      .send({ reason: 'prueba' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('skipped');

    const detail = await request(app).get(`/api/olt-actions/${id}`).set(READER);
    expect(detail.body.status).toBe('skipped');
  });

  it('404 en acción inexistente', async () => {
    await request(app).get('/api/olt-actions/oa-inexistente').set(READER).expect(404);
    await request(app).post('/api/olt-actions/oa-inexistente/cancel').set(ADMIN).expect(404);
  });
});

describe('Credenciales SSH de OLT', () => {
  let app: Express;
  let oltId: string;

  beforeAll(async () => {
    app = createApp();
    const created = await request(app)
      .post('/api/olts')
      .set(ADMIN)
      .send({ name: 'OLT Cred', brand: 'ZTE', model: 'C320', managementIp: '10.10.0.3' });
    oltId = created.body.id;
  });

  it('guarda la credencial sin devolver ni exponer el password', async () => {
    const password = 'Sup3r-S3cret-OLT';
    const res = await request(app)
      .put(`/api/olts/${oltId}/credentials`)
      .set(ADMIN)
      .send({ username: 'nugacore-noc', password });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: 'nugacore-noc', hasPassword: true, isActive: true });
    expect(JSON.stringify(res.body)).not.toContain(password);

    const meta = await request(app).get(`/api/olts/${oltId}/credentials`).set(ADMIN);
    expect(meta.status).toBe(200);
    expect(JSON.stringify(meta.body)).not.toContain(password);
    expect(meta.body.encryptedPassword).toBeUndefined();
  });

  it('exige username y password mínimo', async () => {
    await request(app)
      .put(`/api/olts/${oltId}/credentials`)
      .set(ADMIN)
      .send({ username: '', password: 'largo-suficiente' })
      .expect(400);
    await request(app)
      .put(`/api/olts/${oltId}/credentials`)
      .set(ADMIN)
      .send({ username: 'noc', password: 'corta' })
      .expect(400);
  });

  it('404 si la OLT no existe y 403 para rol de lectura', async () => {
    await request(app)
      .put('/api/olts/olt-fantasma/credentials')
      .set(ADMIN)
      .send({ username: 'noc', password: 'largo-suficiente' })
      .expect(404);
    await request(app)
      .put(`/api/olts/${oltId}/credentials`)
      .set(READER)
      .send({ username: 'noc', password: 'largo-suficiente' })
      .expect(403);
  });

  it('informa hasPassword=false cuando no hay credencial cargada', async () => {
    const otra = await request(app)
      .post('/api/olts')
      .set(ADMIN)
      .send({ name: 'OLT Sin Cred', brand: 'VSOL', model: 'V1600D', managementIp: '10.10.0.4' });
    const res = await request(app).get(`/api/olts/${otra.body.id}/credentials`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(false);
  });
});
