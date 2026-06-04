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
  connectionType?: 'WISP' | 'FTTH';
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
  napId?: string;
  napPort?: number;
}

export interface Ticket {
  id: string;
  clientName: string;
  clientId?: string;
  title: string;
  description: string;
  category: 'Internet' | 'Facturacion' | 'Instalacion' | 'Falla Red' | 'Otro';
  severity: 'low' | 'medium' | 'high' | 'critical';
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'open' | 'assigned' | 'resolved' | 'closed';
  slaHours: number;
  technicianId?: string;
  technicianName?: string;
  updatedAt?: string;
  created: string;
  messages: { sender: string; message: string; date: string }[];
  attachments?: {
    id: string;
    name: string;
    url: string;
    type?: string;
    uploadedAt: string;
    uploadedBy?: string;
  }[];
  history?: {
    id: string;
    action: string;
    detail: string;
    createdAt: string;
    createdBy?: string;
  }[];
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
  scheduledStart?: string;
  scheduledEnd?: string;
  assignedTechnicianId?: string;
  technicianName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'canceled';
  checklist: { item: string; done: boolean }[];
  signature?: string; // Base64
  photos?: string[];
  evidences?: {
    id: string;
    kind: 'photo' | 'document';
    url: string;
    uploadedAt: string;
    uploadedBy?: string;
    notes?: string;
  }[];
  history?: {
    id: string;
    action: string;
    detail: string;
    createdAt: string;
    createdBy?: string;
  }[];
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
  // Campos enriquecidos por el backend (EnrichedInvoice). Opcionales y aditivos:
  // el contrato GET /api/billing/invoices siempre los incluye, pero se dejan
  // opcionales para no romper datos mock/legacy ni otros consumidores del tipo.
  paidAmount?: number;
  pendingAmount?: number;
}

// Estado de cuenta por factura — respuesta de GET /api/billing/invoices/:id/account-state.
export interface InvoiceAllocation {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  paymentDate: string;
  transactionId?: string;
  remainingAfterPayment: number;
}

export interface AccountStateResponse {
  invoice: Invoice;
  allocations: InvoiceAllocation[];
}

// Resumen de cobranza — respuesta de GET /api/billing/account-summary.
export interface BillingAccountSummary {
  totalInvoiced: number;
  totalCollected: number;
  totalPending: number;
  overdueCount: number;
  paidCount: number;
  unpaidCount: number;
  invoicesCount: number;
}

// Reporte de ingresos — respuesta de GET /api/billing/revenue-report.
export interface BillingRevenueReport {
  generatedAt: string;
  byMethod: { method: string; amount: number }[];
  topPendingInvoices: Invoice[];
}

// ── MikroTik provisioning (Fase 4.4) ──────────────────────────────────
export type MikrotikConnectionType = 'wireguard' | 'sstp' | 'direct' | 'zerotier' | 'tailscale';
export type MikrotikProvisioningStatus = 'pending' | 'provisioned' | 'connected' | 'error';

export interface MikrotikRouterView {
  id: string;
  name: string;
  towerId?: string;
  routerOsVersion: string;
  connectionType: MikrotikConnectionType;
  managementIp?: string;
  vpnIp?: string;
  apiPort: number;
  apiSslPort: number;
  status: MikrotikProvisioningStatus;
  hasCredentials: boolean;
  username: string;
  lastSeenAt?: string;
  notes?: string;
  lastHealthCheckAt: string;
  // Campos legacy presentes en la respuesta combinada:
  ipAddress?: string;
  isOnline?: boolean;
}

export interface ProvisioningScriptResponse {
  router: MikrotikRouterView;
  script: string;
  scriptVersion: string;
  scriptHash: string;
  connectionType: 'wireguard' | 'sstp';
  warnings: string[];
  credentials: { apiUsername: string; vpnUsername: string };
  provisioningToken: string;
  tokenExpiresAt: string;
  securityWarning: string;
}

export interface MikrotikTestConnectionResponse {
  routerId: string;
  dryRun: boolean;
  mode: string;
  reachable: boolean;
  checks: { name: string; ok: boolean }[];
  message: string;
}

// ── Motor de Suspensiones (Fase 4.5) ──────────────────────────────────
export type ServiceStatus = 'ACTIVE' | 'WARNING' | 'PENDING_SUSPENSION' | 'SUSPENDED' | 'PENDING_REACTIVATION';
export type SuspensionBillingStatus = 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'DELINQUENT';
export type SuspensionOrderStatus = 'PENDING' | 'QUEUED' | 'EXECUTED' | 'FAILED' | 'CANCELLED';

export interface CustomerServiceView {
  customerId: string;
  customerName: string;
  serviceStatus: ServiceStatus;
  billingStatus: SuspensionBillingStatus;
  networkStatus: string;
  reason: string;
  worstInvoiceId?: string;
  lastEvaluatedAt?: string;
  lastSuspensionAt?: string;
  lastReactivationAt?: string;
}

export interface SuspensionOrder {
  id: string;
  customerId: string;
  invoiceId?: string;
  orderType: 'suspension' | 'reactivation';
  status: SuspensionOrderStatus;
  source: 'engine' | 'manual';
  reason?: string;
  scheduledFor?: string;
  executedAt?: string;
  createdAt: string;
}

export interface SuspensionEvent {
  id: string;
  customerId: string;
  invoiceId?: string;
  eventType: string;
  reason?: string;
  automatic: boolean;
  actorId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface SuspensionPolicy {
  id: string;
  name: string;
  enabled: boolean;
  graceDays: number;
  suspendAfterDue: boolean;
  reactivateOnPayment: boolean;
  reactivateOnPartialPayment: boolean;
  autoReactivate: boolean;
  dueSoonDays: number;
  updatedAt: string;
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

export interface NapPort {
  num: number;
  status: 'occupied' | 'free';
  client: string;
}

export interface NapBox {
  id: string;
  name: string;
  ponPort: string;
  fibersFree: number;
  fibersTotal: number;
  lat: number;
  lng: number;
  splitRatio: string;
  coverageMeters: number;
  ports: NapPort[];
}
