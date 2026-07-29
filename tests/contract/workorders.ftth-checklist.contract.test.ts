import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// El técnico cierra órdenes (TECH_ROLES); crearlas es de despacho (WRITE_WO_ROLES).
const TECH = { 'x-user-role': 'tecnico', 'x-user-id': 'tecnico-campo' };
const DISPATCH = { 'x-user-role': 'soporte', 'x-user-id': 'despacho' };

const createOrder = async (app: Express, body: Record<string, unknown>) => {
  const res = await request(app)
    .post('/api/workorders')
    .set(DISPATCH)
    .send({
      title: 'Instalación FTTH',
      clientId: 'c-1',
      date: '2026-07-30',
      type: 'installation',
      status: 'pending',
      ...body,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};

describe('Checklist FTTH en órdenes de trabajo', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('persiste tecnología y captura de campo', async () => {
    const order = await createOrder(app, {
      technology: 'fiber',
      ftth: { onuSerial: '48575443A1B2C3D4', napId: 'NAP-01' },
    });
    expect(order.technology).toBe('fiber');
    expect(order.ftth.onuSerial).toBe('48575443A1B2C3D4');
  });

  it('bloquea el cierre de una orden de fibra sin checklist', async () => {
    const order = await createOrder(app, { technology: 'fiber' });
    const res = await request(app)
      .post(`/api/workorders/${order.id}/status`)
      .set(TECH)
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FTTH_CHECKLIST_INCOMPLETE');
    expect(res.body.details.errors.join(' ')).toMatch(/serie de la ONU/i);

    const after = await request(app).get(`/api/workorders/${order.id}`).set(TECH);
    expect(after.body.status).toBe('pending');
  });

  it('bloquea el cierre con potencia fuera de rango y lo explica', async () => {
    const order = await createOrder(app, {
      technology: 'fiber',
      ftth: { onuSerial: 'SN-1', napId: 'NAP-01', napPort: 3, rxPowerDbm: -29.5 },
    });
    const res = await request(app)
      .post(`/api/workorders/${order.id}/status`)
      .set(TECH)
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FTTH_RX_POWER_OUT_OF_RANGE');
    expect(res.body.details.errors[0]).toMatch(/-29.5 dBm/);
  });

  it('cierra cuando el técnico envía la medición correcta en el mismo request', async () => {
    const order = await createOrder(app, {
      technology: 'fiber',
      ftth: { onuSerial: 'SN-2', napId: 'NAP-01', napPort: 4 },
    });
    const res = await request(app)
      .post(`/api/workorders/${order.id}/status`)
      .set(TECH)
      .send({ status: 'completed', ftth: { rxPowerDbm: -22.1 } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.ftth.rxPowerDbm).toBe(-22.1);
    // La serie capturada antes no se pierde al mezclar la medición.
    expect(res.body.ftth.onuSerial).toBe('SN-2');
  });

  it('una orden de radio se cierra sin campos ópticos', async () => {
    const order = await createOrder(app, { technology: 'radio', title: 'Cambio de antena' });
    const res = await request(app)
      .post(`/api/workorders/${order.id}/status`)
      .set(TECH)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('las órdenes previas sin tecnología declarada siguen cerrando igual', async () => {
    const order = await createOrder(app, {});
    const res = await request(app)
      .post(`/api/workorders/${order.id}/status`)
      .set(TECH)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
  });

  it('el gate también aplica al update general y a la creación en completed', async () => {
    const order = await createOrder(app, { technology: 'fiber' });
    const viaPut = await request(app)
      .put(`/api/workorders/${order.id}`)
      .set(DISPATCH)
      .send({ status: 'completed' });
    expect(viaPut.status).toBe(422);

    const viaCreate = await request(app)
      .post('/api/workorders')
      .set(DISPATCH)
      .send({
        title: 'Alta ya cerrada',
        clientId: 'c-1',
        date: '2026-07-30',
        status: 'completed',
        technology: 'fiber',
      });
    expect(viaCreate.status).toBe(422);
  });

  it('rechaza tecnologías desconocidas', async () => {
    const order = await createOrder(app, {});
    await request(app)
      .put(`/api/workorders/${order.id}`)
      .set(DISPATCH)
      .send({ technology: 'satelital' })
      .expect(400);
  });

  it('sync-batch no cierra órdenes de fibra incompletas', async () => {
    const order = await createOrder(app, { technology: 'fiber' });
    const res = await request(app)
      .post('/api/workorders/sync-batch')
      .set(TECH)
      .send({ items: [{ orderId: order.id, action: 'status', payload: { status: 'completed' } }] });

    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(1);
    const after = await request(app).get(`/api/workorders/${order.id}`).set(TECH);
    expect(after.body.status).toBe('pending');
  });
});
