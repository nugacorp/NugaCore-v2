export type CustomerEquipmentKind = 'CPE' | 'POE' | 'POWER_SUPPLY' | 'ONU' | 'OTHER';

export interface CustomerEquipment {
  id: string;
  kind: CustomerEquipmentKind;
  name: string;
  brand: string;
  model: string;
  availableQty: number;
  serials: string[];
}

export interface CreateEquipmentReservationInput {
  equipmentId: string;
  serial: string;
  mac: string;
  customerLabel: string;
}

export interface ManualEquipmentReservationInput {
  name: string;
  kind: CustomerEquipmentKind;
  brand?: string;
  model?: string;
  serial: string;
  mac: string;
  customerLabel: string;
}

export interface EquipmentReservation extends CreateEquipmentReservationInput {
  id: string;
  equipmentName: string;
  status: 'RESERVED';
  createdAt: string;
}
