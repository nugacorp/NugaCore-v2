import { Client, FiberSegment, Invoice, NapBox, NocAlert, OltFTTH, OnuFTTH, Plan, TaskOrder, Ticket, Tower, WarehouseItem } from '../../src/types';
import type { IntegrationSettingsRecord } from '../domains/integrations/types';

export type AlertSourceType = 'tower' | 'olt' | 'client' | 'system';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface NotificationSettings {
  pushEnabled: boolean;
  latencyThresholdMs: number;
  fiberCutAlertEnabled: boolean;
  browserSubscribed: boolean;
  webhooksCount: number;
}

export interface MonitoringSnapshot {
  id: string;
  targetId: string;
  targetType: 'tower' | 'olt' | 'router' | 'client';
  targetLabel: string;
  status: 'online' | 'offline' | 'degraded';
  latencyMs: number;
  packetLossPct: number;
  createdAt: string;
}

export interface MikrotikLog {
  timestamp: string;
  message: string;
}

export interface MikrotikRouterRegistryItem {
  id: string;
  name: string;
  /** WISP dueño. Ausente en datos legacy → se trata como tenant-default. */
  tenantId?: string;
  ipAddress: string;
  apiPort: number;
  username: string;
  encryptedPassword: string;
  isOnline: boolean;
  cpuUsagePct: number;
  memoryUsagePct: number;
  routerOsVersion: string;
  linkedTowerId?: string;
  lastHealthCheckAt: string;
  // ── Provisioning (Fase 4.4) — campos opcionales/aditivos ──────────
  connectionType?: 'wireguard' | 'sstp' | 'direct' | 'zerotier' | 'tailscale';
  managementIp?: string;
  vpnIp?: string;
  apiSslPort?: number;
  provisioningStatus?: 'pending' | 'provisioned' | 'connected' | 'error';
  notes?: string;
  lastSeenAt?: string;
  encryptionVersion?: string;
  credentialRotatedAt?: string;
  // ── DB-1 · alineación con el modelo canónico de mikrotik_routers ──
  // `status` es el espejo DEPRECATED de `provisioningStatus` (columna canónica).
  // `hasCredentials` se deriva normalmente de `encryptedPassword`.
  // `createdAt`/`updatedAt` reflejan el ciclo de vida de la fila DB.
  status?: 'pending' | 'provisioned' | 'connected' | 'error';
  hasCredentials?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface MikrotikCommandAudit {
  id: string;
  routerId?: string;
  routerName?: string;
  command: string;
  mode: 'read' | 'write';
  status: 'allowed' | 'blocked' | 'executed';
  executedBy?: string;
  message: string;
  createdAt: string;
}

export interface ClientTimelineEvent {
  id: string;
  clientId: string;
  eventType: 'created' | 'status_change' | 'lead_conversion' | 'updated' | 'note';
  summary: string;
  details?: string;
  createdAt: string;
  createdBy?: string;
  /**
   * Identidad durable del efecto de webhook (T5). Nulas en el resto de
   * llamadas y en filas históricas; su unicidad es un índice PARCIAL.
   */
  tenantId?: string;
  idempotencyKey?: string;
}

export interface PlanMetadata {
  planId: string;
  businessType: 'Residencial' | 'Empresarial' | 'Dedicado';
  isActive: boolean;
}

export interface PaymentAllocation {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  paymentDate: string;
  transactionId?: string;
  /** Proveedor del cobro durable; ausente en pagos manuales/históricos. */
  provider?: string;
  remainingAfterPayment: number;
  /**
   * Identidad tenant-scoped del pago de webhook (T5). Nula en pagos manuales
   * y en filas históricas: la unicidad del ledger es un índice PARCIAL.
   */
  tenantId?: string;
  idempotencyKey?: string;
  /** El cargo que cruzó pendiente→saldada bajo la exclusión del ledger. */
  settlementWinner?: boolean;
}

export interface InventoryItemState {
  itemId: string;
  operationalStatus: 'Disponible' | 'Instalado' | 'En reparacion' | 'Danado' | 'Perdido' | 'Baja';
  assignedToType?: 'tower' | 'client' | 'technician' | 'warehouse';
  assignedToId?: string;
  assignedToLabel?: string;
  updatedAt: string;
}

export interface InventoryMovementLog {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in' | 'out' | 'transfer';
  qty: number;
  fromWarehouse?: string;
  toWarehouse?: string;
  reason?: string;
  actorId?: string;
  createdAt: string;
}

export interface InventoryAssignmentLog {
  id: string;
  itemId: string;
  itemName: string;
  action: 'assign' | 'unassign';
  qty: number;
  targetType?: 'tower' | 'client' | 'technician';
  targetId?: string;
  targetLabel?: string;
  notes?: string;
  actorId?: string;
  createdAt: string;
}

export interface NetworkSector {
  id: string;
  towerId: string;
  name: string;
  azimuth: number;
  frequency: string;
  status: 'online' | 'warning' | 'offline';
  clientsCount: number;
}

export interface SuspensionPolicy {
  enabled: boolean;
  graceDays: number;
  allowAutoReactivateOnPayment: boolean;
}

export interface SuspensionActionLog {
  id: string;
  clientId: string;
  clientName: string;
  action: 'suspend' | 'reactivate' | 'rule-scan';
  reason: string;
  source: 'manual' | 'automation';
  actorId?: string;
  createdAt: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: 'vencimiento' | 'pago' | 'suspension' | 'alerta';
  enabled: boolean;
  threshold?: number;
  channels?: string[];
  lastRunAt?: string;
}

export interface SecurityAuditLog {
  id: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  resource: string;
  method: string;
  statusCode: number;
  success: boolean;
  source: string;
  metadata?: string;
  createdAt: string;
}

export interface BackupPolicy {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  retentionDays: number;
  encrypted: boolean;
  location: string;
  lastBackupAt?: string;
}

// ── Payment Engine (Fase 4.8) ─────────────────────────────────────────
export type PaymentOrderStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'cancelled';
export type PaymentEventStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type MikrotikActionType = 'reactivate' | 'suspend' | 'speed_change' | 'disconnect' | 'custom';
export type MikrotikActionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';

export interface PaymentOrderRecord {
  id: string;
  /** WISP dueño de la orden; ausente en filas legacy => tenant-default. */
  tenantId?: string;
  customerId: string;
  invoiceId: string;
  provider: string;
  providerOrderId?: string;
  amountCents: number;
  status: PaymentOrderStatus;
  checkoutUrl?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEventRecord {
  id: string;
  /** Tenant/lease fields used by the atomic webhook claim (T5). */
  tenantId?: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  processed: boolean;
  paymentOrderId?: string;
  payload: Record<string, unknown>;
  receivedAt: string;
  claimedAt?: string;
  claimToken?: string;
  processedAt?: string;
}

export interface MikrotikActionRecord {
  id: string;
  customerId: string;
  routerId?: string;
  actionType: MikrotikActionType;
  status: MikrotikActionStatus;
  dryRun: boolean;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  triggeredBy?: string;
  createdAt: string;
  updatedAt: string;
}

export const store: {
  PLANS: Plan[];
  CLIENTS: Client[];
  TOWERS: Tower[];
  OLTS: OltFTTH[];
  ONUS: OnuFTTH[];
  NAP_BOXES: NapBox[];
  FIBER_SEGMENTS: FiberSegment[];
  TICKETS: Ticket[];
  WORK_ORDERS: TaskOrder[];
  INVENTORY: WarehouseItem[];
  INVOICES: Invoice[];
  NOC_ALERTS: NocAlert[];
  MIKROTIK_LOGS: MikrotikLog[];
  MIKROTIK_ROUTERS: MikrotikRouterRegistryItem[];
  MIKROTIK_COMMAND_AUDIT: MikrotikCommandAudit[];
  CLIENT_TIMELINE: ClientTimelineEvent[];
  PLAN_METADATA: PlanMetadata[];
  PAYMENT_ALLOCATIONS: PaymentAllocation[];
  INVENTORY_ITEM_STATES: InventoryItemState[];
  INVENTORY_MOVEMENTS: InventoryMovementLog[];
  INVENTORY_ASSIGNMENTS: InventoryAssignmentLog[];
  NETWORK_SECTORS: NetworkSector[];
  SUSPENSION_POLICY: SuspensionPolicy;
  SUSPENSION_ACTION_LOGS: SuspensionActionLog[];
  AUTOMATION_RULES: AutomationRule[];
  SECURITY_AUDIT_LOGS: SecurityAuditLog[];
  BACKUP_POLICY: BackupPolicy;
  NOTIFICATION_SETTINGS: NotificationSettings;
  /** null = nunca se persistió la fila legacy 'default'. */
  INTEGRATION_SETTINGS: IntegrationSettingsRecord | null;
  /** Credenciales de integración por WISP (multi-tenant). 'default' vive en INTEGRATION_SETTINGS. */
  INTEGRATION_SETTINGS_BY_TENANT: Record<string, IntegrationSettingsRecord>;
  MONITORING_SNAPSHOTS: MonitoringSnapshot[];
  PAYMENT_ORDERS: PaymentOrderRecord[];
  PAYMENT_EVENTS: PaymentEventRecord[];
  MIKROTIK_ACTIONS: MikrotikActionRecord[];
  createAlert: (type: AlertSourceType, severity: AlertSeverity, source: string, message: string) => void;
  addClientTimelineEvent: (event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>) => void;
  getPlanMetadata: (planId: string) => PlanMetadata;
  getInventoryState: (itemId: string) => InventoryItemState;
  logInventoryMovement: (event: Omit<InventoryMovementLog, 'id' | 'createdAt'>) => void;
  logInventoryAssignment: (event: Omit<InventoryAssignmentLog, 'id' | 'createdAt'>) => void;
  logMikrotikCommandAudit: (event: Omit<MikrotikCommandAudit, 'id' | 'createdAt'>) => void;
  logSuspensionAction: (event: Omit<SuspensionActionLog, 'id' | 'createdAt'>) => void;
  logMonitoringSnapshot: (event: Omit<MonitoringSnapshot, 'id' | 'createdAt'>) => void;
  logSecurityAudit: (event: Omit<SecurityAuditLog, 'id' | 'createdAt'>) => void;
  getUniqueClientId: () => string;
  getUniqueInvoiceId: () => string;
  getUniqueOnuId: () => string;
  getUniqueTicketId: () => string;
  getUniqueWorkOrderId: () => string;
  getUniquePlanId: () => string;
  getUniquePaymentAllocationId: () => string;
  getUniqueSectorId: () => string;
  getUniqueMikrotikRouterId: () => string;
  getUniqueAutomationRuleId: () => string;
  getUniquePaymentOrderId: () => string;
  getUniquePaymentEventId: () => string;
  getUniqueMikrotikActionId: () => string;
} = {
  PLANS: [
    { id: 'plan-basic', name: 'Nuga Residencial 20M', speedMbpsDown: 20, speedMbpsUp: 5, price: 299, type: 'PPPoE' },
    { id: 'plan-plus', name: 'Nuga Residencial 50M', speedMbpsDown: 50, speedMbpsUp: 10, price: 449, type: 'PPPoE' },
    { id: 'plan-ultra', name: 'Nuga Residencial 100M', speedMbpsDown: 100, speedMbpsUp: 20, price: 699, type: 'PPPoE' },
    { id: 'plan-corp-small', name: 'Nuga Empresarial 100M Dedicado', speedMbpsDown: 100, speedMbpsUp: 100, price: 2499, type: 'Static' },
    { id: 'plan-corp-gig', name: 'Nuga Corp Giga Simetrico', speedMbpsDown: 1000, speedMbpsUp: 1000, price: 11999, type: 'Static' },
  ],
  CLIENTS: [
    { id: 'c-1', name: 'Sofia Rodriguez Mendoza', type: 'residential', status: 'active', email: 'sofia.rodriguez@email.com', phone: '5512345678', address: 'Av. Insurgentes Sur 1204', city: 'CDMX', lat: 19.3891, lng: -99.1783, planId: 'plan-plus', ip: '10.100.10.12', connectionType: 'FTTH', mac: 'BC:E6:7C:12:34:56', pppoeUser: 'sofia_rodriguez_nuga', pppoePassword: 'pass_sofiarod_99', contractId: 'CONT-2026-103', documents: [{ name: 'INE', url: '#', date: '2026-01-10' }, { name: 'Comp_Domicilio', url: '#', date: '2026-01-10' }], installationPhotos: [], installationDate: '2026-01-12' },
    { id: 'c-2', name: 'Corporativo Reforma S.A.', type: 'corporate', status: 'active', email: 'it@reforma.com', phone: '5576543210', address: 'Paseo de la Reforma 250', city: 'CDMX', lat: 19.4273, lng: -99.1676, planId: 'plan-corp-small', ip: '192.168.200.4', connectionType: 'FTTH', mac: '00:15:6D:EE:AA:11', contractId: 'CONT-2026-104', installationDate: '2026-01-15' },
    { id: 'c-3', name: 'Hotel Vista Hermosa', type: 'hotel', status: 'active', email: 'gerencia@hotelvista.om', phone: '7449876543', address: 'Costera Miguel Aleman 405', city: 'Acapulco', lat: 16.8534, lng: -99.8821, planId: 'plan-corp-gig', ip: '10.100.40.2', connectionType: 'FTTH', mac: '44:D9:E7:AA:BB:CC', contractId: 'CONT-2026-105', installationDate: '2026-02-01' },
    { id: 'c-4', name: 'Rodrigo Flores Ortiz', type: 'residential', status: 'suspended', email: 'rodrigo.flores@email.com', phone: '5587654321', address: 'Calle 10, Col. San Pedro de los Pinos', city: 'CDMX', lat: 19.3908, lng: -99.1895, planId: 'plan-basic', ip: '10.100.10.45', connectionType: 'WISP', mac: 'BC:E6:7C:99:A1:C2', pppoeUser: 'rodrigo_flores_nuga', pppoePassword: 'pw_rodrigo_f123', contractId: 'CONT-2026-118' },
    { id: 'c-5', name: 'Escuela Primaria Benito Juarez', type: 'school', status: 'active', email: 'directora@bjprimaria.edu.mx', phone: '5544332211', address: 'Calle Juarez s/n, Col. Centro', city: 'CDMX', lat: 19.4125, lng: -99.1555, planId: 'plan-plus', ip: '10.100.10.88', connectionType: 'FTTH', mac: 'E0:3F:49:FF:22:98' },
    { id: 'c-lead-1', name: 'Mario Moreno Cantinflas', type: 'residential', status: 'lead', email: 'mario.moreno@cantinflas.org', phone: '5522119933', address: 'Plaza Garibaldi 12', city: 'CDMX', lat: 19.4412, lng: -99.1394, planId: 'plan-plus', ip: '0.0.0.0', connectionType: 'WISP', notes: 'Interesado en internet residencial. Factibilidad aprobada del Sector Norte. Espera asignacion de tecnico.' },
    { id: 'c-lead-2', name: 'Restaurante El Cardenal', type: 'corporate', status: 'lead', email: 'administracion@elcardenal.mx', phone: '5544998811', address: 'Calle de la Palma 23', city: 'CDMX', lat: 19.4348, lng: -99.1332, planId: 'plan-corp-small', ip: '0.0.0.0', connectionType: 'FTTH', notes: 'Requiere enlace simetrico para terminales punto de venta y Wi-Fi para clientes.' },
  ],
  TOWERS: [
    { id: 't-1', name: 'Torre del Valle (Norte)', status: 'online', lat: 19.3912, lng: -99.1712, height: 45, coverageRadiusKm: 5, ip: '10.0.1.1', cpu: 32, ram: 45, tempCelsius: 38, pingMs: 8, uptime: '45d 12h 30m', ports: [{ port: 'eth1 (WAN)', status: 'up', speed: '1 Gbps' }, { port: 'eth2 (SFP)', status: 'up', speed: '10 Gbps' }, { port: 'eth3 (Sector Norte)', status: 'up', speed: '100 Mbps' }, { port: 'eth4 (Sector Sur)', status: 'up', speed: '100 Mbps' }], equipment: [{ name: 'RB5009UG+S+OUT', type: 'Router principal', brand: 'MikroTik' }, { name: 'Rocket5 AC Prism', type: 'Sectorial AP 5Ghz', brand: 'Ubiquiti' }, { name: 'Cambium ePMP 3000', type: 'AP Sectorial', brand: 'Cambium Networks' }] },
    { id: 't-2', name: 'Repetidor San Pedro', status: 'online', lat: 19.3854, lng: -99.1910, height: 25, coverageRadiusKm: 3, ip: '10.0.1.2', cpu: 14, ram: 28, tempCelsius: 32, pingMs: 14, uptime: '12d 4h 15m', ports: [{ port: 'eth1 (Uplink)', status: 'up', speed: '1 Gbps' }, { port: 'eth2 (Local AP)', status: 'up', speed: '100 Mbps' }], equipment: [{ name: 'PowerBeam 5AC Gen2', type: 'Enlace Punto a Punto', brand: 'Ubiquiti' }, { name: 'EdgeRouter 12', type: 'Router Local', brand: 'Ubiquiti' }] },
    { id: 't-3', name: 'Torre Ajusco (Sur-Master)', status: 'warning', lat: 19.2985, lng: -99.2132, height: 60, coverageRadiusKm: 15, ip: '10.0.1.3', cpu: 78, ram: 82, tempCelsius: 52, pingMs: 24, uptime: '158d 1h 5m', ports: [{ port: 'eth1 (WAN Fiber)', status: 'up', speed: '10 Gbps' }, { port: 'eth2', status: 'up', speed: '1 Gbps' }, { port: 'eth3 (Sector Poniente)', status: 'up', speed: '100 Mbps' }], equipment: [{ name: 'CCR2116-12G-4S+', type: 'Router Core', brand: 'MikroTik' }, { name: 'Mimosa A5c', type: 'Access Point Quad-Sector', brand: 'Mimosa' }] },
  ],
  OLTS: [
    { id: 'olt-1', name: 'OLT Centro Huawei MA5800', status: 'online', brand: 'Huawei', ip: '10.200.1.1', portsCount: 16, onusConnected: 124, onusLimit: 1024, splitters: [{ id: 'splt-1', ratio: '1:64', fiberLine: 1, occupied: 45 }, { id: 'splt-2', ratio: '1:64', fiberLine: 2, occupied: 62 }, { id: 'splt-3', ratio: '1:32', fiberLine: 3, occupied: 17 }] },
  ],
  ONUS: [
    { id: 'onu-1', clientId: 'c-1', clientName: 'Sofia Rodriguez Mendoza', oltId: 'olt-1', port: 1, mac: 'HWTC:A1:B2:C3:44', signalDb: -19.5, status: 'online', brand: 'Huawei', model: 'EG8145V5', napId: 'NAP-01', napPort: 1 },
    { id: 'onu-2', clientId: 'c-5', clientName: 'Escuela Primaria Benito Juarez', oltId: 'olt-1', port: 2, mac: 'HWTC:FE:11:22:90', signalDb: -22.3, status: 'online', brand: 'Huawei', model: 'EG8010H', napId: 'NAP-01', napPort: 4 },
  ],
  NAP_BOXES: [
    {
      id: 'NAP-01',
      name: 'NAP Principal Centro Col. Juarez',
      ponPort: 'PON-01',
      fibersFree: 3,
      fibersTotal: 8,
      lat: 19.4285,
      lng: -99.1655,
      splitRatio: '1:8',
      coverageMeters: 250,
      ports: [
        { num: 1, status: 'occupied', client: 'Sofia Rodriguez Mendoza (onu-1)' },
        { num: 2, status: 'occupied', client: 'Banco Comunitario' },
        { num: 3, status: 'occupied', client: 'Hotel Las Flores' },
        { num: 4, status: 'occupied', client: 'Escuela Primaria Benito Juarez (onu-2)' },
        { num: 5, status: 'occupied', client: 'Felipe de Jesus' },
        { num: 6, status: 'free', client: '' },
        { num: 7, status: 'free', client: '' },
        { num: 8, status: 'free', client: '' },
      ],
    },
    {
      id: 'NAP-02',
      name: 'NAP Alterna Sur Condesa',
      ponPort: 'PON-02',
      fibersFree: 6,
      fibersTotal: 8,
      lat: 19.4185,
      lng: -99.1555,
      splitRatio: '1:8',
      coverageMeters: 300,
      ports: [
        { num: 1, status: 'occupied', client: 'Raul Jimenez' },
        { num: 2, status: 'occupied', client: 'Clinica Santa Maria' },
        { num: 3, status: 'free', client: '' },
        { num: 4, status: 'free', client: '' },
        { num: 5, status: 'free', client: '' },
        { num: 6, status: 'free', client: '' },
        { num: 7, status: 'free', client: '' },
        { num: 8, status: 'free', client: '' },
      ],
    },
    {
      id: 'NAP-03',
      name: 'NAP Ajusco Sector Alto',
      ponPort: 'PON-03',
      fibersFree: 1,
      fibersTotal: 16,
      lat: 19.2185,
      lng: -99.1855,
      splitRatio: '1:16',
      coverageMeters: 200,
      ports: [
        { num: 1, status: 'occupied', client: 'Marta Diaz' },
        { num: 2, status: 'occupied', client: 'Gimnasio Olimpico' },
        { num: 3, status: 'occupied', client: 'Oficina Gubernamental' },
        { num: 4, status: 'occupied', client: 'Estancia Infantil' },
        { num: 5, status: 'occupied', client: 'Estetica Express' },
        { num: 6, status: 'occupied', client: 'Fabrica de Hielo' },
        { num: 7, status: 'occupied', client: 'Taller Mecanico' },
        { num: 8, status: 'occupied', client: 'Tienda La Luz' },
        { num: 9, status: 'occupied', client: 'Farmacia Centro' },
        { num: 10, status: 'occupied', client: 'Papeleria ABC' },
        { num: 11, status: 'occupied', client: 'Hotel Ajusco' },
        { num: 12, status: 'occupied', client: 'Caseta Forestal' },
        { num: 13, status: 'occupied', client: 'Socio de Negocios' },
        { num: 14, status: 'occupied', client: 'Colegio Ajusco' },
        { num: 15, status: 'occupied', client: 'Puesto de Inspeccion' },
        { num: 16, status: 'free', client: '' },
      ],
    },
  ],
  FIBER_SEGMENTS: [],
  TICKETS: [
    { id: 'tk-1', clientName: 'Rodrigo Flores Ortiz', clientId: 'c-4', title: 'Servicio suspendido tras pago realizado', description: 'El cliente reporta que pago hace 3 horas por transferencia bancaria, pero sigue saliendo el portal de cobro en su navegador. Solicita reactivacion.', category: 'Facturacion', severity: 'medium', status: 'open', slaHours: 4, created: '2026-05-31 01:22', messages: [{ sender: 'Cliente', message: 'Ya pague mi recibo del mes de Mayo, por favor reactiven el servicio.', date: '2026-05-31 01:22' }] },
    { id: 'tk-2', clientName: 'Hotel Vista Hermosa', clientId: 'c-3', title: 'Paquetes perdidos en enlace dedicado', description: 'Departamento de TI del hotel reporta perdida de paquetes de un 8% detectada en su monitoreo. El ping a la IP publica fluctua entre 15ms y 240ms.', category: 'Internet', severity: 'high', status: 'assigned', slaHours: 2, technicianId: 'tech-1', created: '2026-05-30 18:45', messages: [{ sender: 'IT Hotel', message: 'Monitoreamos ping alto y paquetes caidos, de favor coordinen con soporte de segundo nivel.', date: '2026-05-30 18:45' }] },
  ],
  WORK_ORDERS: [
    { id: 'wo-1', title: 'Instalacion nueva alta residencial', type: 'installation', clientName: 'Mario Moreno Cantinflas', clientId: 'c-lead-1', address: 'Plaza Garibaldi 12, CDMX', phone: '5522119933', notes: 'Instalacion estandar. Cruzar cable drop por poste izquierdo. Dejar router configurado en modo PPPoE con usuario mario_cantinflas.', date: '2026-06-01', technicianName: 'Juan Perez (Principal)', status: 'pending', checklist: [{ item: 'Factibilidad fisica y nivel de senal drop (-18dB a -25dB)', done: false }, { item: 'Fijacion de herraje tensor y cable drop', done: false }, { item: 'Fusion de fibra e instalacion de roseta', done: false }, { item: 'Aprovisionamiento de la ONU', done: false }, { item: 'Prueba de ping y velocidad de subida/bajada', done: false }, { item: 'Firma de conformidad de cliente', done: false }] },
    { id: 'wo-2', title: 'Reubicacion de antena CPE por arbolado', type: 'reallocation', clientName: 'Rodrigo Flores Ortiz', clientId: 'c-4', address: 'Calle 10, de los Pinos, CDMX', phone: '5587654321', notes: 'El cliente reporta reubicacion ya que crecieron arboles enfrente de la visual a Torre del Valle.', date: '2026-05-31', technicianName: 'Carlos Gomez (Instalador Jr)', status: 'in_progress', checklist: [{ item: 'Evaluar nueva ubicacion con mastil de 3m', done: true }, { item: 'Montaje de antena Ubiquiti LiteBeam', done: true }, { item: 'Alineacion de senal (esperado < -65dBm)', done: false }, { item: 'Validacion de trafico y ping constante', done: false }] },
  ],
  INVENTORY: [
    { id: 'item-1', name: 'LiteBeam 5AC Gen2', category: 'CPE', model: 'LBE-5AC-Gen2', brand: 'Ubiquiti', qty: 45, warehouse: 'Principal', serials: ['LBE5AC0011', 'LBE5AC0012', 'LBE5AC0013'] },
    { id: 'item-2', name: 'hEX lite Router', category: 'Router', model: 'RB750r2', brand: 'MikroTik', qty: 12, warehouse: 'Principal', serials: ['HEX7509A', 'HEX7509B'] },
    { id: 'item-3', name: 'Bobina Fibra Drop 1 Hilo SM (1km)', category: 'Fiber', model: 'Drop-SM-1H-1000', brand: 'NugaFiber', qty: 8, warehouse: 'Principal', serials: ['FIBER-DP-9012', 'FIBER-DP-9013'] },
    { id: 'item-4', name: 'ONU GPON AC1200 Wi-Fi', category: 'CPE', model: 'EG8145V5', brand: 'Huawei', qty: 24, warehouse: 'Coche Tecnico 1', serials: ['HWTCA12B34C1', 'HWTCA12B34C2'] },
    { id: 'item-5', name: 'Switch PoE 24 Puertos L2', category: 'Switch', model: 'ES-24-250W', brand: 'Ubiquiti', qty: 2, warehouse: 'Torre Alfa', serials: ['ES24P250W01'] },
  ],
  INVOICES: [
    { id: 'fac-101', clientId: 'c-1', clientName: 'Sofia Rodriguez Mendoza', amount: 449, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'paid', cfdiStatus: 'generated', cfdiUuid: '3F1A4BC2-9904-4F54-AD0B-883F217A3BB1', items: [{ description: 'Servicio de Internet Resiliente 50M - Mes Mayo 2026', price: 449, qty: 1 }], payments: [{ date: '2026-05-05 10:30', amount: 449, method: 'Stripe', transactionId: 'ch_3Mv2h9LkdJUws0X32a8Xj' }] },
    { id: 'fac-102', clientId: 'c-2', clientName: 'Corporativo Reforma S.A.', amount: 2499, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'paid', cfdiStatus: 'generated', cfdiUuid: '99CC3B24-8D03-12FC-77AA-9081273FFBA0', items: [{ description: 'Enlace Dedicado Simetrico 100M - Mayo 2026', price: 2499, qty: 1 }], payments: [{ date: '2026-05-08 14:15', amount: 2499, method: 'SPEI', transactionId: 'SPEI88921013a2' }] },
    { id: 'fac-103', clientId: 'c-4', clientName: 'Rodrigo Flores Ortiz', amount: 299, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'unpaid', cfdiStatus: 'pending', items: [{ description: 'Servicio de Internet Resiliente 20M - Mes Mayo 2026', price: 299, qty: 1 }], payments: [] },
    { id: 'fac-104', clientId: 'c-3', clientName: 'Hotel Vista Hermosa', amount: 11999, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'paid', cfdiStatus: 'generated', cfdiUuid: 'FF123984-AAA-BBBB-CCCC-DDDD12456', items: [{ description: 'Super Enlace Giga Simetrico - Mayo 2026', price: 11999, qty: 1 }], payments: [{ date: '2026-05-09 09:12', amount: 11999, method: 'PayPal', transactionId: 'pay_99FF0123' }] },
    { id: 'fac-105', clientId: 'c-5', clientName: 'Escuela Primaria Benito Juarez', amount: 449, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'overdue', cfdiStatus: 'pending', items: [{ description: 'Servicio de Internet Resiliente 50M - Mes Mayo 2026', price: 449, qty: 1 }], payments: [] },
  ],
  NOC_ALERTS: [
    { id: 'alt-1', source: 'Torre Ajusco (Sur-Master)', sourceType: 'tower', severity: 'warning', message: 'Temperatura de CPU elevada a 52°C. Carga del ventilador al 90%.', timestamp: '2026-05-31 02:40', acknowledged: false },
    { id: 'alt-2', source: 'Rodrigo Flores Ortiz', sourceType: 'client', severity: 'critical', message: 'Cliente suspendido por falta de pago detectara portal cautivo (IP 10.100.10.45).', timestamp: '2026-05-31 03:00', acknowledged: true },
  ],
  MIKROTIK_LOGS: [
    { timestamp: '2026-05-31 03:30:12', message: 'pppoe,info pppoe-in-sofia_rodriguez: logged in' },
    { timestamp: '2026-05-31 03:31:00', message: 'script,info AutoSuspension trigger: user rodrigo_flores_nuga disabled, queue deactivated' },
    { timestamp: '2026-05-31 03:35:15', message: 'system,info,account user admin logged in from 10.0.0.101 via winbox' },
    { timestamp: '2026-05-31 03:39:50', message: 'interface,info SFP port Link-Up speed 10Gbps full-duplex' },
  ],
  MIKROTIK_ROUTERS: [
    {
      id: 'mkt-1',
      name: 'Torre del Valle (Norte)',
      ipAddress: '10.0.1.1',
      apiPort: 8728,
      username: 'admin',
      encryptedPassword: 'demo.encrypted.password',
      isOnline: true,
      cpuUsagePct: 32,
      memoryUsagePct: 45,
      routerOsVersion: '7.12',
      linkedTowerId: 't-1',
      lastHealthCheckAt: '2026-05-31 03:39',
    },
    {
      id: 'mkt-2',
      name: 'Torre Ajusco (Sur-Master)',
      ipAddress: '10.0.1.3',
      apiPort: 8728,
      username: 'admin',
      encryptedPassword: 'demo.encrypted.password',
      isOnline: true,
      cpuUsagePct: 78,
      memoryUsagePct: 82,
      routerOsVersion: '7.14.2',
      linkedTowerId: 't-3',
      lastHealthCheckAt: '2026-05-31 03:39',
    },
    {
      id: 'mkt-3',
      name: 'Repetidor San Pedro',
      ipAddress: '10.0.1.5',
      apiPort: 8728,
      username: 'admin',
      encryptedPassword: 'demo.encrypted.password',
      isOnline: true,
      cpuUsagePct: 18,
      memoryUsagePct: 28,
      routerOsVersion: '6.49',
      linkedTowerId: 't-2',
      lastHealthCheckAt: '2026-05-31 03:39',
    },
  ],
  MIKROTIK_COMMAND_AUDIT: [],
  CLIENT_TIMELINE: [
    {
      id: 'ct-1',
      clientId: 'c-4',
      eventType: 'status_change',
      summary: 'Cliente suspendido por cobranza vencida',
      details: 'Suspension automatica por factura fac-103 vencida.',
      createdAt: '2026-05-31 03:31',
      createdBy: 'system',
    },
    {
      id: 'ct-2',
      clientId: 'c-1',
      eventType: 'updated',
      summary: 'Cliente actualizado por mesa de ayuda',
      details: 'Se actualizo telefono de contacto y notas comerciales.',
      createdAt: '2026-05-30 18:10',
      createdBy: 'support',
    },
  ],
  PLAN_METADATA: [
    { planId: 'plan-basic', businessType: 'Residencial', isActive: true },
    { planId: 'plan-plus', businessType: 'Residencial', isActive: true },
    { planId: 'plan-ultra', businessType: 'Residencial', isActive: true },
    { planId: 'plan-corp-small', businessType: 'Empresarial', isActive: true },
    { planId: 'plan-corp-gig', businessType: 'Dedicado', isActive: true },
  ],
  PAYMENT_ALLOCATIONS: [],
  INVENTORY_ITEM_STATES: [
    {
      itemId: 'item-1',
      operationalStatus: 'Disponible',
      assignedToType: 'warehouse',
      assignedToId: 'principal',
      assignedToLabel: 'Almacen Principal',
      updatedAt: '2026-05-30 10:10',
    },
    {
      itemId: 'item-5',
      operationalStatus: 'Instalado',
      assignedToType: 'tower',
      assignedToId: 't-1',
      assignedToLabel: 'Torre del Valle (Norte)',
      updatedAt: '2026-05-22 16:20',
    },
  ],
  INVENTORY_MOVEMENTS: [
    {
      id: 'mov-1',
      itemId: 'item-1',
      itemName: 'LiteBeam 5AC Gen2',
      type: 'out',
      qty: 3,
      fromWarehouse: 'Principal',
      reason: 'Salida para instalaciones residenciales del dia.',
      actorId: 'tech-1',
      createdAt: '2026-05-29 08:45',
    },
  ],
  INVENTORY_ASSIGNMENTS: [
    {
      id: 'asg-1',
      itemId: 'item-5',
      itemName: 'Switch PoE 24 Puertos L2',
      action: 'assign',
      qty: 1,
      targetType: 'tower',
      targetId: 't-1',
      targetLabel: 'Torre del Valle (Norte)',
      notes: 'Instalado para ampliacion de puertos en sitio.',
      actorId: 'admin',
      createdAt: '2026-05-22 16:20',
    },
  ],
  NETWORK_SECTORS: [
    {
      id: 'sec-1',
      towerId: 't-1',
      name: 'Sector Norte 5.8GHz',
      azimuth: 0,
      frequency: '5800 MHz',
      status: 'online',
      clientsCount: 38,
    },
    {
      id: 'sec-2',
      towerId: 't-1',
      name: 'Sector Sur 5.8GHz',
      azimuth: 180,
      frequency: '5800 MHz',
      status: 'online',
      clientsCount: 34,
    },
    {
      id: 'sec-3',
      towerId: 't-3',
      name: 'Sector Poniente 5.4GHz',
      azimuth: 270,
      frequency: '5400 MHz',
      status: 'warning',
      clientsCount: 22,
    },
  ],
  SUSPENSION_POLICY: {
    enabled: true,
    graceDays: 3,
    allowAutoReactivateOnPayment: true,
  },
  SUSPENSION_ACTION_LOGS: [
    {
      id: 'sus-1',
      clientId: 'c-4',
      clientName: 'Rodrigo Flores Ortiz',
      action: 'suspend',
      reason: 'Factura vencida sin pago despues de ventana de gracia.',
      source: 'automation',
      actorId: 'system',
      createdAt: '2026-05-31 03:31',
    },
  ],
  AUTOMATION_RULES: [
    {
      id: 'rule-1',
      name: 'Suspension automatica por vencimiento',
      trigger: 'vencimiento',
      enabled: true,
      threshold: 3,
      channels: ['dashboard', 'email'],
      lastRunAt: '2026-05-31 03:40',
    },
    {
      id: 'rule-2',
      name: 'Reactivacion automatica por pago',
      trigger: 'pago',
      enabled: true,
      channels: ['dashboard'],
      lastRunAt: '2026-05-31 03:41',
    },
    {
      id: 'rule-3',
      name: 'Alerta de latencia NOC',
      trigger: 'alerta',
      enabled: true,
      threshold: 120,
      channels: ['dashboard', 'telegram'],
      lastRunAt: '2026-05-31 03:42',
    },
  ],
  SECURITY_AUDIT_LOGS: [
    {
      id: 'audit-1',
      actorId: 'system',
      actorRole: 'super admin',
      action: 'startup',
      resource: '/api/system',
      method: 'INIT',
      statusCode: 200,
      success: true,
      source: 'backend',
      metadata: 'Inicializacion de servicios de API.',
      createdAt: '2026-05-31 03:30',
    },
  ],
  BACKUP_POLICY: {
    enabled: true,
    frequency: 'daily',
    retentionDays: 30,
    encrypted: true,
    location: 's3://nugacore-backups/dev',
    lastBackupAt: '2026-05-31 02:00',
  },
  NOTIFICATION_SETTINGS: {
    pushEnabled: true,
    latencyThresholdMs: 120,
    fiberCutAlertEnabled: true,
    browserSubscribed: false,
    webhooksCount: 2,
  },
  INTEGRATION_SETTINGS: null,
  INTEGRATION_SETTINGS_BY_TENANT: {},
  PAYMENT_ORDERS: [],
  PAYMENT_EVENTS: [],
  MIKROTIK_ACTIONS: [],
  MONITORING_SNAPSHOTS: [
    {
      id: 'mon-1',
      targetId: 't-1',
      targetType: 'tower',
      targetLabel: 'Torre del Valle (Norte)',
      status: 'online',
      latencyMs: 8,
      packetLossPct: 0,
      createdAt: '2026-05-31 03:45',
    },
    {
      id: 'mon-2',
      targetId: 't-3',
      targetType: 'tower',
      targetLabel: 'Torre Ajusco (Sur-Master)',
      status: 'degraded',
      latencyMs: 45,
      packetLossPct: 4,
      createdAt: '2026-05-31 03:45',
    },
    {
      id: 'mon-3',
      targetId: 'olt-1',
      targetType: 'olt',
      targetLabel: 'OLT Centro Huawei MA5800',
      status: 'online',
      latencyMs: 16,
      packetLossPct: 0,
      createdAt: '2026-05-31 03:45',
    },
  ],
  createAlert(type, severity, source, message) {
    const newAlert: NocAlert = {
      id: 'alt-' + Date.now(),
      source,
      sourceType: type,
      severity,
      message,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      acknowledged: false,
    };
    this.NOC_ALERTS.unshift(newAlert);
  },
  addClientTimelineEvent(event) {
    this.CLIENT_TIMELINE.unshift({
      id: 'ct-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
  },
  getPlanMetadata(planId) {
    const existing = this.PLAN_METADATA.find((m) => m.planId === planId);
    if (existing) return existing;

    const fallback: PlanMetadata = {
      planId,
      businessType: 'Residencial',
      isActive: true,
    };
    this.PLAN_METADATA.push(fallback);
    return fallback;
  },
  getInventoryState(itemId) {
    const existing = this.INVENTORY_ITEM_STATES.find((state) => state.itemId === itemId);
    if (existing) return existing;

    const fallback: InventoryItemState = {
      itemId,
      operationalStatus: 'Disponible',
      assignedToType: 'warehouse',
      assignedToId: 'principal',
      assignedToLabel: 'Almacen Principal',
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };
    this.INVENTORY_ITEM_STATES.push(fallback);
    return fallback;
  },
  logInventoryMovement(event) {
    this.INVENTORY_MOVEMENTS.unshift({
      id: 'mov-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
  },
  logInventoryAssignment(event) {
    this.INVENTORY_ASSIGNMENTS.unshift({
      id: 'asg-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
  },
  logMikrotikCommandAudit(event) {
    this.MIKROTIK_COMMAND_AUDIT.unshift({
      id: 'mkta-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
  },
  logSuspensionAction(event) {
    this.SUSPENSION_ACTION_LOGS.unshift({
      id: 'sus-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
  },
  logMonitoringSnapshot(event) {
    this.MONITORING_SNAPSHOTS.unshift({
      id: 'mon-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
    if (this.MONITORING_SNAPSHOTS.length > 200) {
      this.MONITORING_SNAPSHOTS = this.MONITORING_SNAPSHOTS.slice(0, 200);
    }
  },
  logSecurityAudit(event) {
    this.SECURITY_AUDIT_LOGS.unshift({
      id: 'audit-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      ...event,
    });
    if (this.SECURITY_AUDIT_LOGS.length > 5000) {
      this.SECURITY_AUDIT_LOGS = this.SECURITY_AUDIT_LOGS.slice(0, 5000);
    }
  },
  getUniqueClientId() {
    let nextNum = 1;
    const ids = new Set(this.CLIENTS.map((c) => c.id));
    while (ids.has(`c-${nextNum}`)) {
      nextNum++;
    }
    return `c-${nextNum}`;
  },
  getUniqueInvoiceId() {
    let nextNum = 100;
    const ids = new Set(this.INVOICES.map((i) => i.id));
    while (ids.has(`fac-${nextNum}`)) {
      nextNum++;
    }
    return `fac-${nextNum}`;
  },
  getUniqueOnuId() {
    let nextNum = 1;
    const ids = new Set(this.ONUS.map((o) => o.id));
    while (ids.has(`onu-${nextNum}`)) {
      nextNum++;
    }
    return `onu-${nextNum}`;
  },
  getUniqueTicketId() {
    let nextNum = 1;
    const ids = new Set(this.TICKETS.map((t) => t.id));
    while (ids.has(`tk-${nextNum}`)) {
      nextNum++;
    }
    return `tk-${nextNum}`;
  },
  getUniqueWorkOrderId() {
    let nextNum = 1;
    const ids = new Set(this.WORK_ORDERS.map((w) => w.id));
    while (ids.has(`wo-${nextNum}`)) {
      nextNum++;
    }
    return `wo-${nextNum}`;
  },
  getUniquePlanId() {
    const ids = new Set(this.PLANS.map((p) => p.id));
    let nextNum = this.PLANS.length + 1;
    while (ids.has(`plan-${nextNum}`)) {
      nextNum++;
    }
    return `plan-${nextNum}`;
  },
  getUniquePaymentAllocationId() {
    let nextNum = this.PAYMENT_ALLOCATIONS.length + 1;
    const ids = new Set(this.PAYMENT_ALLOCATIONS.map((p) => p.id));
    while (ids.has(`pay-${nextNum}`)) {
      nextNum++;
    }
    return `pay-${nextNum}`;
  },
  getUniqueSectorId() {
    let nextNum = this.NETWORK_SECTORS.length + 1;
    const ids = new Set(this.NETWORK_SECTORS.map((sector) => sector.id));
    while (ids.has(`sec-${nextNum}`)) {
      nextNum++;
    }
    return `sec-${nextNum}`;
  },
  getUniqueMikrotikRouterId() {
    let nextNum = this.MIKROTIK_ROUTERS.length + 1;
    const ids = new Set(this.MIKROTIK_ROUTERS.map((router) => router.id));
    while (ids.has(`mkt-${nextNum}`)) {
      nextNum++;
    }
    return `mkt-${nextNum}`;
  },
  getUniqueAutomationRuleId() {
    let nextNum = this.AUTOMATION_RULES.length + 1;
    const ids = new Set(this.AUTOMATION_RULES.map((rule) => rule.id));
    while (ids.has(`rule-${nextNum}`)) {
      nextNum++;
    }
    return `rule-${nextNum}`;
  },
  getUniquePaymentOrderId() {
    let nextNum = this.PAYMENT_ORDERS.length + 1;
    const ids = new Set(this.PAYMENT_ORDERS.map((p) => p.id));
    while (ids.has(`po-${nextNum}`)) {
      nextNum++;
    }
    return `po-${nextNum}`;
  },
  getUniquePaymentEventId() {
    let nextNum = this.PAYMENT_EVENTS.length + 1;
    const ids = new Set(this.PAYMENT_EVENTS.map((e) => e.id));
    while (ids.has(`pe-${nextNum}`)) {
      nextNum++;
    }
    return `pe-${nextNum}`;
  },
  getUniqueMikrotikActionId() {
    let nextNum = this.MIKROTIK_ACTIONS.length + 1;
    const ids = new Set(this.MIKROTIK_ACTIONS.map((a) => a.id));
    while (ids.has(`ma-${nextNum}`)) {
      nextNum++;
    }
    return `ma-${nextNum}`;
  },
};

/**
 * En staging/producción pública NO se sirven datos demo/mock del store.
 * SEED_DEMO_DATA=false o PUBLIC_DEPLOYMENT=true → inventario/dashboard vacíos
 * hasta que entren datos reales (DB, alta de routers, UISP, etc.).
 * En tests/dev local (sin esos flags) se conservan seeds para desarrollo.
 */
export const seedDemoData = (): boolean => {
  const explicit = (process.env.SEED_DEMO_DATA || '').trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return (process.env.PUBLIC_DEPLOYMENT || 'false').trim().toLowerCase() !== 'true';
};

if (!seedDemoData()) {
  // Red / NOC / Mikrotik
  store.TOWERS = [];
  store.NETWORK_SECTORS = [];
  store.MIKROTIK_ROUTERS = [];
  store.NOC_ALERTS = [];
  store.MIKROTIK_LOGS = [];
  store.MIKROTIK_COMMAND_AUDIT = [];
  store.MIKROTIK_ACTIONS = [];
  store.MONITORING_SNAPSHOTS = [];
  // FTTH inventado
  store.OLTS = [];
  store.ONUS = [];
  store.NAP_BOXES = [];
  store.FIBER_SEGMENTS = [];
  // CRM / cobranza / ops demo (dominios con USE_DB_* leen Supabase; store vacío no afecta)
  store.CLIENTS = [];
  store.CLIENT_TIMELINE = [];
  store.TICKETS = [];
  store.WORK_ORDERS = [];
  store.INVOICES = [];
  store.INVENTORY = [];
  store.INVENTORY_ITEM_STATES = [];
  store.INVENTORY_MOVEMENTS = [];
  store.INVENTORY_ASSIGNMENTS = [];
  store.SUSPENSION_ACTION_LOGS = [];
  store.PAYMENT_ALLOCATIONS = [];
  store.PAYMENT_ORDERS = [];
  store.PAYMENT_EVENTS = [];
}
