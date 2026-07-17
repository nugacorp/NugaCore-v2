// ====================================================================
// System Metrics — Single Source of Truth (SSOT) de KPIs.
//
// Propósito (Pre-PROD-7 / Data Consistency Audit):
//   Centralizar el cálculo de CADA KPI ejecutivo en UN solo lugar, leyendo
//   siempre de la FUENTE OFICIAL del dominio. El Dashboard, el panel de
//   Cobranza y el auditor de consistencia consumen estas funciones; ninguno
//   recalcula por su cuenta. Así desaparecen los números divergentes entre
//   módulos (clientes activos, MRR, cobrado del mes, etc.).
//
//   Read-only y sin efectos: no muta estado, no toca RouterOS/MikroTik, no
//   ejecuta el motor de suspensiones. Solo agrega lo que ya existe.
//
// Fuentes oficiales (ver docs/DATA_CONSISTENCY_AUDIT.md):
//   - Clientes (activos/suspendidos/leads) → CRM (CustomersService)
//   - MRR, Facturación/Cobrado del mes, Pendiente, Vencidas, Adeudo → Billing
//   - Tickets abiertos                     → Support (SupportService)
//   - Torres / SLA de red                  → Network (store.TOWERS)
//   - Capacidad / Clientes por torre       → IPAM (IpamService)
//   - Equipos reservados / instalaciones   → Inventory + Tickets (WORK_ORDERS)
// ====================================================================

import { store } from '../../state/store';
import { getCustomersService } from '../customers/service';
import { getBillingService } from '../billing/service';
import { ipamService } from '../ipam/service';
import { customerEquipmentService } from '../inventory/customer-equipment/service';
import { getPlansService } from '../plans/service';
import { getServiceStatusSummary } from '../service-status/service';
import { getSupportService } from '../tickets/service';

const round = (v: number): number => Math.round(v * 100) / 100;

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

// ── Tipos públicos ────────────────────────────────────────────────────

export interface CustomerMetrics {
  active: number;
  suspended: number;
  leads: number;
  baja: number;
  /** Suspendidos + bajas: clientes sin servicio facturando. */
  offline: number;
}

export interface BillingMetrics {
  month: string;
  /** MRR oficial: suscripciones activas/suspendidas × precio de plan. */
  mrr: number;
  facturacionMes: number;
  cobradoMes: number;
  pendienteCobro: number;
  facturasVencidas: number;
  clientesConAdeudo: number;
  topAdeudos: Array<{
    invoiceId: string;
    clientId: string;
    clientName: string;
    pendingAmount: number;
    dueDateStr: string;
    status: string;
  }>;
}

export interface TicketMetrics {
  active: number;
  resolved: number;
  total: number;
}

export interface TowerMetrics {
  online: number;
  warning: number;
  offline: number;
  /** SLA de red = disponibilidad de torres (online + warning×0.5). */
  availabilityPct: number;
}

export interface CapacityMetrics {
  clientsByTower: Array<{ routerId: string; routerName: string; activeClients: number }>;
  capacityUtilizationPercent: number;
}

export interface InventoryMetrics {
  reservedEquipment: number;
  pendingInstallations: number;
}

/** Conteos por estado operativo oficial — FUENTE: Service Status (SSOT). */
export interface ServiceStatusMetrics {
  active: number;
  pendingInstall: number;
  suspensionPending: number;
  suspended: number;
  reactivationPending: number;
  cancelled: number;
}

export interface MetricsSnapshot {
  generatedAt: string;
  customers: CustomerMetrics;
  billing: BillingMetrics;
  tickets: TicketMetrics;
  towers: TowerMetrics;
  capacity: CapacityMetrics;
  inventory: InventoryMetrics;
  serviceStatus: ServiceStatusMetrics;
}

// ── Cálculos puros por fuente oficial ─────────────────────────────────

/** Clientes por estatus — FUENTE OFICIAL: CRM (CustomersService). */
export async function getCustomerMetrics(tenantId?: string): Promise<CustomerMetrics> {
  const clients = await getCustomersService().list(tenantId ? { tenantId } : {});
  const count = (status: string) => clients.filter((c) => c.status === status).length;
  const suspended = count('suspended');
  const baja = count('baja');
  return {
    active: count('active'),
    suspended,
    leads: count('lead'),
    baja,
    offline: suspended + baja,
  };
}

/** MRR — FUENTE OFICIAL: Billing/Revenue. Suscripciones que facturan
 *  (active + suspended) × precio del plan. CRM no recalcula MRR. */
export async function getMrr(tenantId?: string): Promise<number> {
  const [clients, plans] = await Promise.all([
    getCustomersService().list(tenantId ? { tenantId } : {}),
    getPlansService().list(tenantId ? { tenantId } : {}),
  ]);
  const priceById = new Map(plans.map((p) => [p.id, p.price]));
  return round(
    clients.reduce((acc, c) => {
      if (c.status === 'active' || c.status === 'suspended') {
        return acc + (priceById.get(c.planId) ?? 0);
      }
      return acc;
    }, 0),
  );
}

/** Cobranza — FUENTE OFICIAL: Billing (BillingService.listInvoices()).
 *  Misma lógica que /api/dashboard/billing-kpis: aquí vive UNA sola vez. */
export async function getBillingMetrics(now = new Date(), tenantId?: string): Promise<BillingMetrics> {
  const month = monthKey(now);
  const invoices = (await getBillingService().listInvoices(tenantId)).filter((inv) => inv.status !== 'canceled');
  const issuedThisMonth = invoices.filter((inv) => String(inv.dateStr || '').startsWith(month));

  const facturacionMes = round(issuedThisMonth.reduce((s, inv) => s + inv.amount, 0));
  const cobradoMes = round(issuedThisMonth.reduce((s, inv) => s + (inv.paidAmount || 0), 0));
  const pendienteCobro = round(invoices.reduce((s, inv) => s + (inv.pendingAmount || 0), 0));
  const withDebt = new Set(invoices.filter((inv) => (inv.pendingAmount || 0) > 0).map((inv) => inv.clientId));
  const facturasVencidas = invoices.filter((inv) => inv.status === 'overdue').length;

  const topAdeudos = invoices
    .filter((inv) => (inv.pendingAmount || 0) > 0)
    .sort((a, b) => (b.pendingAmount || 0) - (a.pendingAmount || 0))
    .slice(0, 10)
    .map((inv) => ({
      invoiceId: inv.id,
      clientId: inv.clientId,
      clientName: inv.clientName,
      pendingAmount: round(inv.pendingAmount || 0),
      dueDateStr: inv.dueDateStr,
      status: inv.status,
    }));

  return {
    month,
    mrr: await getMrr(tenantId),
    facturacionMes,
    cobradoMes,
    pendienteCobro,
    clientesConAdeudo: withDebt.size,
    facturasVencidas,
    topAdeudos,
  };
}

/** Tickets — FUENTE OFICIAL: SupportService (respeta USE_DB_SUPPORT). */
export async function getTicketMetrics(tenantId?: string): Promise<TicketMetrics> {
  const tickets = await getSupportService().listTickets(tenantId ? { tenantId } : {});
  const active = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;
  const resolved = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;
  return { active, resolved, total: active + resolved };
}

/** Torres / SLA de red — FUENTE OFICIAL: Network (store.TOWERS). */
export function getTowerMetrics(): TowerMetrics {
  const online = store.TOWERS.filter((t) => t.status === 'online').length;
  const warning = store.TOWERS.filter((t) => t.status === 'warning').length;
  const offline = store.TOWERS.filter((t) => t.status === 'offline').length;
  const total = store.TOWERS.length;
  const availabilityPct = total > 0
    ? round(((online + warning * 0.5) / total) * 100)
    : 100;
  return { online, warning, offline, availabilityPct };
}

/** Capacidad / Clientes por torre — FUENTE OFICIAL: IPAM (IpamService). */
export async function getCapacityMetrics(): Promise<CapacityMetrics> {
  const routers = await ipamService.listRouters();
  const capacities = (
    await Promise.all(routers.map((item) => ipamService.capacity(item.id)))
  ).filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    clientsByTower: capacities.map((capacity) => ({
      routerId: capacity.routerId,
      routerName: capacity.routerName,
      activeClients: capacity.activeClients,
    })),
    capacityUtilizationPercent: capacities.length > 0
      ? round(capacities.reduce((sum, item) => sum + item.utilizationPercent, 0) / capacities.length)
      : 0,
  };
}

/** Equipos reservados + instalaciones pendientes — FUENTE OFICIAL:
 *  Inventory (reservas) + Support (órdenes de instalación abiertas). */
export async function getInventoryMetrics(): Promise<InventoryMetrics> {
  const reservedEquipment = customerEquipmentService.countReservations();
  const workOrders = await getSupportService().listWorkOrders({ type: 'installation' });
  const openInstallations = workOrders.filter(
    (order) => order.status !== 'canceled' && order.status !== 'completed',
  ).length;
  return {
    reservedEquipment,
    pendingInstallations: openInstallations + reservedEquipment,
  };
}

/** Estado operativo oficial por cliente — FUENTE OFICIAL: Service Status.
 *  El KPI "Suspendidos" consume `suspended` (no el customerStatus del CRM). */
export async function getServiceStatusMetrics(): Promise<ServiceStatusMetrics> {
  const summary = await getServiceStatusSummary();
  return {
    active: summary.byStatus.ACTIVE,
    pendingInstall: summary.byStatus.PENDING_INSTALL,
    suspensionPending: summary.byStatus.SUSPENSION_PENDING,
    suspended: summary.byStatus.SUSPENDED,
    reactivationPending: summary.byStatus.REACTIVATION_PENDING,
    cancelled: summary.byStatus.CANCELLED,
  };
}

// ── Snapshot agregado (lo consume el Dashboard) ───────────────────────

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

export async function getMetricsSnapshot(tenantId?: string): Promise<MetricsSnapshot> {
  const [customers, billing, capacity, serviceStatus, tickets, inventory] = await Promise.all([
    getCustomerMetrics(tenantId),
    getBillingMetrics(new Date(), tenantId),
    getCapacityMetrics(),
    getServiceStatusMetrics(),
    getTicketMetrics(tenantId),
    getInventoryMetrics(),
  ]);
  return {
    generatedAt: nowStamp(),
    customers,
    billing,
    tickets,
    towers: getTowerMetrics(),
    capacity,
    inventory,
    serviceStatus,
  };
}

export const systemMetrics = {
  customers: getCustomerMetrics,
  mrr: getMrr,
  billing: getBillingMetrics,
  tickets: getTicketMetrics,
  towers: getTowerMetrics,
  capacity: getCapacityMetrics,
  inventory: getInventoryMetrics,
  serviceStatus: getServiceStatusMetrics,
  snapshot: getMetricsSnapshot,
};
