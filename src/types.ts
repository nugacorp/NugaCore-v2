export interface Plan {
  id: string;
  name: string;
  speedMbpsDown: number;
  speedMbpsUp: number;
  price: number;
  type: 'PPPoE' | 'Hotspot' | 'DHCP' | 'Static';
}

export interface Client {
  id: string;
  name: string;
  type: 'residential' | 'corporate' | 'government' | 'hotel' | 'school';
  status: 'active' | 'suspended' | 'lead' | 'baja';
  email: string;
  phone: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  planId: string;
  ip: string;
  mac?: string;
  pppoeUser?: string;
  pppoePassword?: string;
  contractId?: string;
  documents?: { name: string; url: string; date: string }[];
  installationPhotos?: string[];
  installationDate?: string;
  notes?: string;
}

export interface Tower {
  id: string;
  name: string;
  status: 'online' | 'warning' | 'offline';
  lat: number;
  lng: number;
  height: number;
  coverageRadiusKm: number;
  ip: string;
  cpu: number;
  ram: number;
  tempCelsius: number;
  pingMs: number;
  uptime: string;
  ports: { port: string; status: 'up' | 'down'; speed: string }[];
  equipment: { name: string; type: string; brand: string }[];
  photos?: string[];
}

export interface OltFTTH {
  id: string;
  name: string;
  status: 'online' | 'offline';
  brand: 'GPON' | 'EPON' | 'XGS-PON' | 'Huawei' | 'ZTE' | 'FiberHome';
  ip: string;
  portsCount: number;
  onusConnected: number;
  onusLimit: number;
  splitters: { id: string; ratio: string; fiberLine: number; occupied: number }[];
}

export interface OnuFTTH {
  id: string;
  clientId: string;
  clientName: string;
  oltId: string;
  port: number;
  mac: string;
  signalDb: number; // e.g. -21.4
  status: 'online' | 'offline' | 'dying_gasp';
  brand: string;
  model: string;
}

export interface Ticket {
  id: string;
  clientName: string;
  clientId?: string;
  title: string;
  description: string;
  category: 'Internet' | 'Facturacion' | 'Instalacion' | 'Falla Red' | 'Otro';
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'assigned' | 'resolved' | 'closed';
  slaHours: number;
  technicianId?: string;
  created: string;
  messages: { sender: string; message: string; date: string }[];
}

export interface TaskOrder {
  id: string;
  title: string;
  type: 'installation' | 'repair' | 'migration' | 'reallocation';
  clientName: string;
  clientId: string;
  address: string;
  phone: string;
  notes: string;
  date: string;
  technicianName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'canceled';
  checklist: { item: string; done: boolean }[];
  signature?: string; // Base64
  photos?: string[];
}

export interface WarehouseItem {
  id: string;
  name: string;
  category: 'CPE' | 'Router' | 'Switch' | 'Antenna' | 'Fiber' | 'OLT' | 'Other';
  model: string;
  brand: string;
  qty: number;
  warehouse: 'Principal' | 'Torre Alfa' | 'Coche Tecnico 1' | 'Coche Tecnico 2';
  serials: string[];
}

export interface Invoice {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  dateStr: string;
  dueDateStr: string;
  status: 'paid' | 'unpaid' | 'overdue' | 'canceled';
  cfdiStatus: 'pending' | 'generated' | 'canceled';
  cfdiUuid?: string;
  items: { description: string; price: number; qty: number }[];
  payments: { date: string; amount: number; method: string; transactionId?: string }[];
}

export interface NocAlert {
  id: string;
  source: string;
  sourceType: 'tower' | 'olt' | 'client' | 'system';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  acknowledged: boolean;
}
