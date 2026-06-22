export type CustomerEquipmentKind = 'CPE' | 'POE' | 'POWER_SUPPLY';

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

export interface EquipmentReservation extends CreateEquipmentReservationInput {
  id: string;
  equipmentName: string;
  status: 'RESERVED';
  createdAt: string;
}
