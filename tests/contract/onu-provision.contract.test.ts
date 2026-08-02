import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const TECH = { 'x-user-role': 'tecnico', 'x-user-id': 'tecnico-campo' };

describe('POST /api/onu/provision — deja de ser stub', () => {
  let app: Express;
  let oltId: string;

  beforeAll(async () => {
    app = createApp();
    const olt = await request(app)
      .post('/api/olts')
      .set({ 'x-user-role': 'administrador', 'x-user-id': 'admin' })
      .send({ name: 'OLT Provision', brand: 'Huawei', model: 'MA5608T', managementIp: '10.20.0.2' });
    oltId = olt.body.id;
  });

  it('encola la autorización en la OLT con el plan de comandos', async () => {
    const res = await request(app)
      .post('/api/onu/provision')
      .set(TECH)
      .send({
        clientId: 'c-1',
        oltId,
        serial: '48575443AABBCCDD',
        ponPort: '0/1/0',
        onuIndex: 7,
        vlan: 100,
        model: 'HG8245',
      });

    expect(res.status).toBe(200);
    expect(res.body.clientId).toBe('c-1');
    expect(res.body.provisioning.queuedActionId).toMatch(/^oa-/);
    expect(res.body.provisioning.dryRun).toBe(true);

    const actions = await request(app).get('/api/olt-actions').query({ oltId }).set(TECH);
    const queued = actions.body.actions.find(
      (a: { id: string }) => a.id === res.body.provisioning.queuedActionId,
    );
    expect(queued.actionType).toBe('provision_onu');
    expect(queued.onuId).toBe(res.body.id);
    expect(queued.customerId).toBe('c-1');
    expect(queued.plannedCommands.join('\n')).toContain('48575443AABBCCDD');
  });

  it('no inventa una lectura de potencia óptica', async () => {
    const res = await request(app)
      .post('/api/onu/provision')
      .set(TECH)
      .send({ clientId: 'c-2', oltId, serial: '48575443EEFF0011', ponPort: '0/1/1', onuIndex: 2, vlan: 100 });
    // 0 dBm es imposible en una ONU real: significa "sin medición", no "señal perfecta".
    expect(res.body.signalDb).toBe(0);
  });

  it('registra la ONU aunque la OLT no esté dada de alta como equipo gestionado', async () => {
    const res = await request(app)
      .post('/api/onu/provision')
      .set(TECH)
      .send({ clientId: 'c-3', oltId: 'olt-no-gestionada', serial: 'ZTEG12345678' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.provisioning.queuedActionId).toBeNull();
    expect(res.body.provisioning.warnings.join(' ')).toMatch(/no está registrada/i);
  });

  it('advierte cuando faltan datos para un plan aplicable', async () => {
    const res = await request(app)
      .post('/api/onu/provision')
      .set(TECH)
      .send({ clientId: 'c-4', oltId });

    expect(res.status).toBe(200);
    expect(res.body.provisioning.warnings.join(' ')).toMatch(/Faltan datos/);
  });

  it('sigue rechazando clientes inválidos', async () => {
    await request(app)
      .post('/api/onu/provision')
      .set(TECH)
      .send({ clientId: 'cliente-fantasma', oltId })
      .expect(400);
  });
});
