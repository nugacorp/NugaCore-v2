import {
  customerEquipmentRepository,
  type CustomerEquipmentRepository,
} from './repository';
import type {
  CreateEquipmentReservationInput,
  CustomerEquipment,
  EquipmentReservation,
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
    if (!equipment.serials.includes(normalized.serial)) {
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

  countReservations(): number {
    return this.repository.listReservations().length;
  }
}

export const customerEquipmentService = new CustomerEquipmentService();
