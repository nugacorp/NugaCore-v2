import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../backend/state/store';
import { CustomerEquipmentRepository } from '../../backend/domains/inventory/customer-equipment/repository';
import {
  CustomerEquipmentService,
  EquipmentReservationError,
} from '../../backend/domains/inventory/customer-equipment/service';

describe('Customer equipment reservations', () => {
  let service: CustomerEquipmentService;

  beforeEach(() => {
    service = new CustomerEquipmentService(new CustomerEquipmentRepository());
  });

  it('expone CPE, PoE y fuentes disponibles', () => {
    const kinds = service.listEquipment().map((item) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(['CPE', 'POE', 'POWER_SUPPLY']));
  });

  it('crea una reserva RESERVED sin descontar stock', () => {
    const equipment = service.listEquipment().find((item) => item.kind === 'CPE');
    expect(equipment).toBeDefined();
    const stockBefore = store.INVENTORY.find((item) => item.id === equipment?.id)?.qty;

    const reservation = service.reserve({
      equipmentId: equipment!.id,
      serial: equipment!.serials[0],
      mac: 'AA:BB:CC:DD:EE:10',
      customerLabel: 'Cliente Reserva',
    });

    expect(reservation).toMatchObject({
      status: 'RESERVED',
      equipmentId: equipment!.id,
      serial: equipment!.serials[0],
    });
    expect(store.INVENTORY.find((item) => item.id === equipment?.id)?.qty).toBe(stockBefore);
  });

  it('rechaza MAC inválida y una serie ya reservada', () => {
    const equipment = service.listEquipment().find((item) => item.serials.length > 0)!;
    expect(() => service.reserve({
      equipmentId: equipment.id,
      serial: equipment.serials[0],
      mac: 'invalid',
      customerLabel: 'Cliente',
    })).toThrow(EquipmentReservationError);

    service.reserve({
      equipmentId: equipment.id,
      serial: equipment.serials[0],
      mac: 'AA:BB:CC:DD:EE:11',
      customerLabel: 'Cliente 1',
    });
    expect(() => service.reserve({
      equipmentId: equipment.id,
      serial: equipment.serials[0],
      mac: 'AA:BB:CC:DD:EE:12',
      customerLabel: 'Cliente 2',
    })).toThrow('Serial is already reserved');
  });
});
