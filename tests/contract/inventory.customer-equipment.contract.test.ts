import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { store } from '../../backend/state/store';

const TECH = { 'x-user-role': 'tecnico', 'x-user-id': 'equipment-tech' };

describe('Customer equipment reservation API', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('lista CPE, PoE y fuentes', async () => {
    const response = await request(app)
      .get('/api/inventory/customer-equipment')
      .set(TECH);
    expect(response.status).toBe(200);
    expect(response.body.map((item: { kind: string }) => item.kind)).toEqual(
      expect.arrayContaining(['CPE', 'POE', 'POWER_SUPPLY']),
    );
  });

  it('reserva en memoria con RESERVED sin modificar stock', async () => {
    const equipment = await request(app)
      .get('/api/inventory/customer-equipment')
      .set(TECH);
    const cpe = equipment.body.find((item: { kind: string }) => item.kind === 'CPE');
    const stockBefore = store.INVENTORY.find((item) => item.id === cpe.id)?.qty;

    const response = await request(app)
      .post('/api/inventory/customer-equipment/reservations')
      .set(TECH)
      .send({
        equipmentId: cpe.id,
        serial: cpe.serials[1],
        mac: 'AA:BB:CC:DD:EE:20',
        customerLabel: 'Cliente Contract Reserva',
      });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('RESERVED');
    expect(store.INVENTORY.find((item) => item.id === cpe.id)?.qty).toBe(stockBefore);
  });
});
