import { store } from '../../../state/store';
import type { WarehouseItem } from '../../../../src/types';
import {
  customerEquipmentRepository,
  type CustomerEquipmentRepository,
} from './repository';
import type {
  CreateEquipmentReservationInput,
  CustomerEquipment,
  CustomerEquipmentKind,
  EquipmentReservation,
  ManualEquipmentReservationInput,
} from './types';

export class EquipmentReservationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EquipmentReservationError';
  }
}

const categoryFromKind = (kind: CustomerEquipmentKind): WarehouseItem['category'] => {
  if (kind === 'CPE' || kind === 'POE') return 'CPE';
  if (kind === 'ONU') return 'Fiber';
  return 'Other';
};

export class CustomerEquipmentService {
  constructor(private readonly repository: CustomerEquipmentRepository = customerEquipmentRepository) {}

  listEquipment(): CustomerEquipment[] {
    return this.repository.listEquipment();
  }

  listReservations(): EquipmentReservation[] {
    return this.repository.listReservations();
  }

  reserve(input: CreateEquipmentReservationInput): EquipmentReservation {
    const normalized = {
      equipmentId: input.equipmentId.trim(),
      serial: input.serial.trim(),
      mac: input.mac.trim().toUpperCase(),
      customerLabel: input.customerLabel.trim(),
    };
    if (!normalized.equipmentId || !normalized.serial || !normalized.mac || !normalized.customerLabel) {
      throw new EquipmentReservationError(
        'equipmentId, serial, mac and customerLabel are required',
        'EQUIPMENT_RESERVATION_INCOMPLETE',
      );
    }
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalized.mac)) {
      throw new EquipmentReservationError('Invalid MAC address', 'EQUIPMENT_MAC_INVALID');
    }

    const equipment = this.listEquipment().find((item) => item.id === normalized.equipmentId);
    if (!equipment || equipment.availableQty <= 0) {
      throw new EquipmentReservationError('Equipment is not available', 'EQUIPMENT_NOT_AVAILABLE');
    }
    // Serie conocida en inventario, o entrada libre si el SKU no trae series.
    if (equipment.serials.length > 0 && !equipment.serials.includes(normalized.serial)) {
      throw new EquipmentReservationError('Serial is not available for this equipment', 'EQUIPMENT_SERIAL_INVALID');
    }

    const existing = this.listReservations();
    if (existing.some((reservation) => reservation.serial === normalized.serial)) {
      throw new EquipmentReservationError('Serial is already reserved', 'EQUIPMENT_SERIAL_RESERVED');
    }
    if (existing.some((reservation) => reservation.mac === normalized.mac)) {
      throw new EquipmentReservationError('MAC is already reserved', 'EQUIPMENT_MAC_RESERVED');
    }

    return this.repository.createReservation(normalized, equipment.name);
  }

  /**
   * Alta manual: crea (o actualiza) el SKU en inventario y reserva serie+MAC.
   * Al confirmar el cliente, el equipo ya existe en inventario.
   */
  reserveManual(input: ManualEquipmentReservationInput): EquipmentReservation {
    const name = String(input.name || '').trim();
    const serial = String(input.serial || '').trim();
    const mac = String(input.mac || '').trim().toUpperCase();
    const customerLabel = String(input.customerLabel || '').trim();
    const kind = input.kind || 'CPE';
    if (!name || !serial || !mac || !customerLabel) {
      throw new EquipmentReservationError(
        'name, serial, mac and customerLabel are required',
        'EQUIPMENT_RESERVATION_INCOMPLETE',
      );
    }
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
      throw new EquipmentReservationError('Invalid MAC address', 'EQUIPMENT_MAC_INVALID');
    }

    const existing = this.listReservations();
    if (existing.some((r) => r.serial === serial)) {
      throw new EquipmentReservationError('Serial is already reserved', 'EQUIPMENT_SERIAL_RESERVED');
    }
    if (existing.some((r) => r.mac === mac)) {
      throw new EquipmentReservationError('MAC is already reserved', 'EQUIPMENT_MAC_RESERVED');
    }

    const category = categoryFromKind(kind);
    let item = store.INVENTORY.find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.category === category,
    );
    if (!item) {
      item = {
        id: `inv-${Date.now().toString(36)}`,
        name,
        category,
        brand: String(input.brand || 'NugaCore').trim() || 'NugaCore',
        model: String(input.model || serial).trim() || serial,
        qty: 1,
        warehouse: 'Principal',
        serials: [serial],
      };
      store.INVENTORY.push(item);
    } else {
      if (!item.serials.includes(serial)) item.serials.push(serial);
      item.qty = Math.max(item.qty, item.serials.length);
    }

    return this.repository.createReservation(
      { equipmentId: item.id, serial, mac, customerLabel },
      item.name,
    );
  }

  countReservations(): number {
    return this.repository.listReservations().length;
  }
}

export const customerEquipmentService = new CustomerEquipmentService();
