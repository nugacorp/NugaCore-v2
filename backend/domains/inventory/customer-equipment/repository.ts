import { store, seedDemoData } from '../../../state/store';
import type {
  CreateEquipmentReservationInput,
  CustomerEquipment,
  EquipmentReservation,
} from './types';

/** Categorías de inventario instalables en alta de cliente. */
const INSTALL_CATEGORIES = new Set(['CPE', 'Fiber', 'Other', 'Antenna']);

const kindFromCategory = (category: string): CustomerEquipment['kind'] => {
  if (category === 'CPE') return 'CPE';
  if (category === 'Fiber') return 'ONU';
  if (category === 'Antenna') return 'CPE';
  return 'OTHER';
};

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
    const fromInventory = store.INVENTORY
      .filter((item) => INSTALL_CATEGORIES.has(item.category) && (item.qty > 0 || item.serials.length > 0))
      .map<CustomerEquipment>((item) => ({
        id: item.id,
        kind: kindFromCategory(item.category),
        name: item.name,
        brand: item.brand,
        model: item.model,
        availableQty: Math.max(item.qty, item.serials.length),
        serials: [...item.serials],
      }));

    if (!seedDemoData()) return fromInventory;

    return [
      ...fromInventory,
      ...MOCK_ACCESSORIES.map((item) => ({ ...item, serials: [...item.serials] })),
    ];
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
