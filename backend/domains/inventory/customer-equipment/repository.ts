import { store } from '../../../state/store';
import type {
  CreateEquipmentReservationInput,
  CustomerEquipment,
  EquipmentReservation,
} from './types';

const MOCK_ACCESSORIES: CustomerEquipment[] = [
  {
    id: 'mock-poe-gigabit-24v',
    kind: 'POE',
    name: 'Inyector PoE Gigabit 24V',
    brand: 'NugaNet',
    model: 'POE-24G',
    availableQty: 18,
    serials: ['POE24G-001', 'POE24G-002', 'POE24G-003'],
  },
  {
    id: 'mock-power-24v',
    kind: 'POWER_SUPPLY',
    name: 'Fuente de poder 24V 1A',
    brand: 'NugaNet',
    model: 'PSU-24V-1A',
    availableQty: 22,
    serials: ['PSU24-001', 'PSU24-002', 'PSU24-003'],
  },
];

export class CustomerEquipmentRepository {
  private readonly reservations: EquipmentReservation[] = [];

  listEquipment(): CustomerEquipment[] {
    const cpes = store.INVENTORY
      .filter((item) => item.category === 'CPE' && item.qty > 0)
      .map<CustomerEquipment>((item) => ({
        id: item.id,
        kind: 'CPE',
        name: item.name,
        brand: item.brand,
        model: item.model,
        availableQty: item.qty,
        serials: [...item.serials],
      }));
    return [...cpes, ...MOCK_ACCESSORIES.map((item) => ({ ...item, serials: [...item.serials] }))];
  }

  listReservations(): EquipmentReservation[] {
    return this.reservations.map((reservation) => ({ ...reservation }));
  }

  createReservation(
    input: CreateEquipmentReservationInput,
    equipmentName: string,
  ): EquipmentReservation {
    const reservation: EquipmentReservation = {
      id: `eqr-${Date.now()}-${this.reservations.length + 1}`,
      ...input,
      equipmentName,
      status: 'RESERVED',
      createdAt: new Date().toISOString(),
    };
    this.reservations.unshift(reservation);
    return { ...reservation };
  }
}

export const customerEquipmentRepository = new CustomerEquipmentRepository();
