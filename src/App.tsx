import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import CrmModule from './components/CrmModule';
import BillingModule from './components/BillingModule';
import NetworkModule from './components/NetworkModule';
import MikrotikModule from './components/MikrotikModule';
import SupportModule from './components/SupportModule';
import InventoryModule from './components/InventoryModule';
import InventoryRoutersModule from './components/InventoryRoutersModule';
import GisModule from './components/GisModule';
import FinanceOwnerModule from './components/FinanceOwnerModule';
import SuspensionModule from './components/SuspensionModule';
import WireguardManagerModule from './components/WireguardManagerModule';
import RouterOsResourcesModule from './components/RouterOsResourcesModule';
import RouterOsTemplatesModule from './components/RouterOsTemplatesModule';
import RouterEnrollmentWizard from './components/RouterEnrollmentWizard';
import PaymentsModule from './components/PaymentsModule';
import LoginForm from './components/LoginForm';
import LandingPage from './components/LandingPage';
import UserMenu from './components/UserMenu';
import { authSession, restoreSessionProfileFromSupabase } from './lib/authSession';
import { UserSessionProfile, isSupabaseConfigured, supabase } from './lib/supabase';
import { canAccessTab, getDefaultTabByRole } from './lib/rbac';

import { 
  Client, 
  Plan, 
  Tower, 
  OltFTTH, 
  OnuFTTH, 
  Ticket, 
  TaskOrder, 
  WarehouseItem, 
  Invoice,
  NocAlert,
  NapBox,
  BillingAccountSummary,
  BillingRevenueReport,
  AccountStateResponse,
  MikrotikRouterView,
  ProvisioningScriptResponse,
  MikrotikTestConnectionResponse,
  MikrotikWorkerRun,
  RouterSnapshot,
  CustomerServiceView,
  SuspensionOrder,
  SuspensionEvent,
  SuspensionPolicy,
  WireguardServerView,
  WireguardPeerView,
  WireguardServerCreated,
  WireguardPeerCreated
} from './types';

import { Cpu, AlertTriangle, CheckCircle, RefreshCw, Menu } from 'lucide-react';

export default function App() {
  const [showLogin, setShowLogin] = useState<boolean>(false);
  const [userSession, setUserSession] = useState<UserSessionProfile | null>(() => authSession.readProfile());
  const [sessionBootstrapped, setSessionBootstrapped] = useState<boolean>(!isSupabaseConfigured);

  // El tab inicial siempre es 'dashboard' (permitido para todos los roles).
  // El efecto de RBAC corrige a un módulo permitido si el rol no lo autoriza.
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorStr, setErrorStr] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  const handleLoginSuccess = (profile: UserSessionProfile, accessToken?: string) => {
    setUserSession(profile);
    authSession.save(profile, accessToken);
    setActiveTab(getDefaultTabByRole(profile.role));
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setUserSession(null);
    authSession.clear();
    setShowLogin(false);
  };

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      if (!isSupabaseConfigured) {
        setSessionBootstrapped(true);
        return;
      }

      const restored = await restoreSessionProfileFromSupabase();
      if (!mounted) return;
      if (restored) {
        setUserSession(restored);
        setActiveTab(getDefaultTabByRole(restored.role));
      } else {
        // Sin sesión válida en Supabase: limpiar cualquier perfil cacheado
        // (evita mostrar el dashboard con una sesión obsoleta) -> login.
        setUserSession(null);
        authSession.clear();
      }
      setSessionBootstrapped(true);
    };

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userSession) return;
    if (!canAccessTab(userSession.role, activeTab)) {
      setNotice('No tienes permiso para este módulo. Redirigiendo...');
      setActiveTab(getDefaultTabByRole(userSession.role));
    }
  }, [activeTab, userSession]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  // DB States
  const [stats, setStats] = useState<any>({
    activeClients: 0,
    suspendedClients: 0,
    leadsCount: 0,
    mrr: 0,
    cobranzaMes: 0,
    facturacionMes: 0,
    activeTickets: 0,
    towers: { online: 0, warning: 0, offline: 0 },
    oltStats: { connected: 0, offlineOnus: 0 }
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingAccountSummary | null>(null);
  const [revenueReport, setRevenueReport] = useState<BillingRevenueReport | null>(null);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [olts, setOlts] = useState<OltFTTH[]>([]);
  const [onus, setOnus] = useState<OnuFTTH[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [workOrders, setWorkOrders] = useState<TaskOrder[]>([]);
  const [inventory, setInventory] = useState<WarehouseItem[]>([]);
  const [alerts, setAlerts] = useState<NocAlert[]>([]);
  const [mikrotikLogs, setMikrotikLogs] = useState<any[]>([]);
  const [naps, setNaps] = useState<NapBox[]>([]);
  const [provisionedRouters, setProvisionedRouters] = useState<MikrotikRouterView[]>([]);
  const [workerRuns, setWorkerRuns] = useState<MikrotikWorkerRun[]>([]);
  const [suspensionCustomers, setSuspensionCustomers] = useState<CustomerServiceView[]>([]);
  const [suspensionOrders, setSuspensionOrders] = useState<SuspensionOrder[]>([]);
  const [suspensionEvents, setSuspensionEvents] = useState<SuspensionEvent[]>([]);
  const [suspensionPolicy, setSuspensionPolicy] = useState<SuspensionPolicy | null>(null);
  const [wgServers, setWgServers] = useState<WireguardServerView[]>([]);
  const [wgPeers, setWgPeers] = useState<WireguardPeerView[]>([]);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};

    // Prefer the freshest Supabase access token (auto-refreshed by supabase-js)
    // so long-lived sessions don't 401 after the ~1h token expiry.
    let accessToken = authSession.readAccessToken();
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        accessToken = data.session.access_token;
      }
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    if (userSession) {
      headers['x-user-role'] = userSession.role;
      headers['x-user-id'] = userSession.id;
    }

    return headers;
  };

  const fetchJson = async (url: string, init?: RequestInit) => {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(url, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(errPayload.error || `HTTP ${response.status}`);
    }

    return response.json();
  };

  // Fetch initial system database.
  // Debe ejecutarse solo cuando ya existe una sesión validada: los endpoints
  // protegidos rechazan correctamente cualquier request sin Bearer JWT.
  const fetchData = async () => {
    if (!sessionBootstrapped || !userSession) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [
        resStats,
        resClients,
        resPlans,
        resInvoices,
        resTowers,
        resOlts,
        resOnus,
        resTickets,
        resWorkOrders,
        resInventory,
        resAlerts,
        resMktLogs,
        resNaps,
        resBillingSummary,
        resRevenueReport
      ] = await Promise.all([
        fetchJson('/api/dashboard-stats'),
        fetchJson('/api/clients'),
        fetchJson('/api/plans'),
        fetchJson('/api/billing/invoices'),
        fetchJson('/api/network-towers'),
        fetchJson('/api/olt'),
        fetchJson('/api/onu'),
        fetchJson('/api/tickets'),
        fetchJson('/api/workorders'),
        fetchJson('/api/inventory'),
        fetchJson('/api/alerts'),
        fetchJson('/api/mikrotik/logs'),
        fetchJson('/api/naps'),
        fetchJson('/api/billing/account-summary'),
        fetchJson('/api/billing/revenue-report')
      ]);

      setStats(resStats);
      setClients(resClients);
      setPlans(resPlans);
      setInvoices(resInvoices);
      setBillingSummary(resBillingSummary);
      setRevenueReport(resRevenueReport);
      setTowers(resTowers);
      setOlts(resOlts);
      setOnus(resOnus);
      setTickets(resTickets);
      setWorkOrders(resWorkOrders);
      setInventory(resInventory);
      setAlerts(resAlerts);
      setMikrotikLogs(resMktLogs);
      setNaps(resNaps);
      setErrorStr('');
      // Cargas aisladas (no participan del Promise.all para no romper a roles
      // sin acceso a esos módulos).
      await loadProvisionedRouters();
      await loadSuspension();
      await loadWorkerRuns();
      await loadWireguard();
    } catch (err: any) {
      console.error(err);
      setErrorStr('Error contacting full-stack back-end server REST API.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionBootstrapped || !userSession) {
      setLoading(false);
      return;
    }

    fetchData();
    // Auto polling for live real-time NOC metrics & alarms, only after auth.
    const timer = setInterval(() => {
      fetchData();
    }, 60000);
    return () => clearInterval(timer);
  }, [sessionBootstrapped, userSession?.id]);

  const handleRefresh = async () => {
    await fetchData();
  };

  const handleAcknowledgeAlerts = async () => {
    try {
      await fetchJson('/api/alerts/acknowledge-all', { method: 'POST' });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handlePostAlert = async (
    type: 'tower' | 'olt' | 'client' | 'system',
    severity: 'critical' | 'warning' | 'info',
    source: string,
    msg: string
  ) => {
    // Simulated live post notification trigger endpoint logic or local append
    console.log("Post alert: ", type, severity, source, msg);
    await fetchData();
  };

  // CLIENT CRUD CONTROLS
  const handleAddClient = async (newClientData: any) => {
    try {
      await fetchJson('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClientData)
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateClientStatus = async (id: string, status: 'active' | 'suspended' | 'baja') => {
    try {
      await fetchJson(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // BILLING TRANSAC CONTROLS
  // `amount` opcional: si se omite, el backend liquida el saldo completo;
  // si se envía, registra un pago parcial. Los errores se RELANZAN para que
  // la UI (BillingModule) pueda mostrar estado de error/éxito.
  const handlePayInvoice = async (invoiceId: string, method: string, amount?: number) => {
    const body: Record<string, unknown> = { method };
    if (typeof amount === 'number' && amount > 0) body.amount = amount;
    await fetchJson(`/api/billing/invoices/${invoiceId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    await fetchData();
  };

  // Estado de cuenta por factura (allocations + saldos). Lo consume BillingModule
  // bajo demanda al abrir el detalle de una factura.
  const fetchAccountState = async (invoiceId: string): Promise<AccountStateResponse> => {
    return fetchJson(`/api/billing/invoices/${invoiceId}/account-state`);
  };

  // ── MikroTik provisioning (Fase 4.4) ─────────────────────────────────
  // Carga aislada con su propio try/catch: el endpoint excluye a Cobranza,
  // así que un 403 NO debe romper la carga global de datos.
  const loadProvisionedRouters = async () => {
    try {
      const data = await fetchJson('/api/mikrotik/routers');
      setProvisionedRouters(data);
    } catch {
      setProvisionedRouters([]);
    }
  };

  const handleCreateRouter = async (payload: Record<string, unknown>) => {
    await fetchJson('/api/mikrotik/routers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await loadProvisionedRouters();
  };

  const handleGenerateScript = async (
    id: string,
    connectionType: string,
    server?: Record<string, unknown>,
  ): Promise<ProvisioningScriptResponse> => {
    return fetchJson(`/api/mikrotik/routers/${id}/provisioning-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionType, ...(server ? { server } : {}) }),
    });
  };

  const handleRotateCredentials = async (
    id: string,
    connectionType: string,
    server?: Record<string, unknown>,
  ): Promise<ProvisioningScriptResponse> => {
    return fetchJson(`/api/mikrotik/routers/${id}/rotate-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, connectionType, ...(server ? { server } : {}) }),
    });
  };

  const handleTestConnection = async (id: string): Promise<MikrotikTestConnectionResponse> => {
    return fetchJson(`/api/mikrotik/routers/${id}/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  };

  // ── Worker MikroTik (Fase 4.6 — Read Only + Dry Run) ─────────────────
  const loadWorkerRuns = async () => {
    try {
      setWorkerRuns(await fetchJson('/api/mikrotik/worker/runs'));
    } catch {
      setWorkerRuns([]);
    }
  };

  const handleRunWorker = async () => {
    await fetchJson('/api/mikrotik/worker/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await loadWorkerRuns();
  };

  const handleReadRouter = async (id: string): Promise<RouterSnapshot> => {
    return fetchJson(`/api/mikrotik/routers/${id}/worker/read`);
  };

  // ── WireGuard Manager (Fase 4.6.1) ───────────────────────────────────
  // Carga aislada: endpoints solo SA/Admin → un 403 NO rompe la carga global.
  const loadWireguard = async () => {
    try {
      const [servers, peers] = await Promise.all([
        fetchJson('/api/wireguard/servers'),
        fetchJson('/api/wireguard/peers'),
      ]);
      setWgServers(servers);
      setWgPeers(peers);
    } catch {
      setWgServers([]);
      setWgPeers([]);
    }
  };

  const handleCreateWgServer = async (payload: Record<string, unknown>): Promise<WireguardServerCreated> => {
    return fetchJson('/api/wireguard/servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  };
  const handleCreateWgPeer = async (payload: Record<string, unknown>): Promise<WireguardPeerCreated> => {
    return fetchJson('/api/wireguard/peers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  };
  const handleRotateWgPeer = async (id: string): Promise<WireguardPeerCreated> => {
    return fetchJson(`/api/wireguard/peers/${id}/rotate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
  };
  const handleRevokeWgPeer = async (id: string): Promise<void> => {
    await fetchJson(`/api/wireguard/peers/${id}`, { method: 'DELETE' });
  };

  // ── Motor de Suspensiones (Fase 4.5) ─────────────────────────────────
  // Carga aislada: el endpoint excluye a Soporte, así que un 403 NO debe
  // romper la carga global de datos.
  const loadSuspension = async () => {
    try {
      const [customers, orders, events, policy] = await Promise.all([
        fetchJson('/api/suspension/customers'),
        fetchJson('/api/suspension/orders'),
        fetchJson('/api/suspension/events'),
        fetchJson('/api/suspension/policies'),
      ]);
      setSuspensionCustomers(customers);
      setSuspensionOrders(orders);
      setSuspensionEvents(events);
      setSuspensionPolicy(policy);
    } catch {
      setSuspensionCustomers([]);
      setSuspensionOrders([]);
      setSuspensionEvents([]);
      setSuspensionPolicy(null);
    }
  };

  const handleEvaluateAllSuspension = async () => {
    await fetchJson('/api/suspension/evaluate-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await loadSuspension();
  };

  const handleEvaluateCustomer = async (customerId: string) => {
    await fetchJson(`/api/suspension/evaluate/${customerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await loadSuspension();
  };

  const handleUpdateSuspensionPolicy = async (patch: Record<string, unknown>) => {
    await fetchJson('/api/suspension/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadSuspension();
  };

  // TECHNICAL INFRASTRUCTURE CONTROLS
  const handleToggleTower = async (id: string) => {
    try {
      await fetchJson(`/api/network-towers/${id}/toggle-state`, {
        method: 'POST'
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleProvisionOnu = async (onuData: any) => {
    try {
      await fetchJson('/api/onu/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onuData)
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Errores RELANZADOS para que BillingModule muestre estado de error/éxito.
  const handleCreateInvoice = async (invoiceData: any) => {
    await fetchJson('/api/billing/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceData)
    });
    await fetchData();
  };

  const handleEditInvoice = async (id: string, invoiceData: any) => {
    await fetchJson(`/api/billing/invoices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceData)
    });
    await fetchData();
  };

  const handleCreateTower = async (towerData: any) => {
    try {
      await fetchJson('/api/network-towers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(towerData)
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // MIKROTIK COMMAND & AI COPILOT
  const handleSendCommand = async (cmd: string, routerId?: string) => {
    return fetchJson('/api/mikrotik/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, routerId })
    });
  };

  const handleAskCopilot = async (prompt: string, routerContext?: any) => {
    return fetchJson('/api/mikrotik/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, routerContext })
    });
  };

  // HELPDESK TICKETS & TECH CHECKS
  const handleAddTicket = async (ticketData: any) => {
    try {
      await fetchJson('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketData)
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handlePostTicketMessage = async (id: string, text: string) => {
    try {
      await fetchJson(`/api/tickets/${id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWorkOrderStatus = async (id: string, status: string, signature?: string, checklist?: any[]) => {
    try {
      await fetchJson(`/api/workorders/${id}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, signature, checklist })
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // ERP ACTIVE MOVEMENTS
  const handleInventoryMovement = async (itemId: string, type: 'in' | 'out' | 'transfer', qty: number, toWarehouse?: string) => {
    try {
      await fetchJson('/api/inventory/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, type, qty, toWarehouse })
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddInventoryItem = async (itemData: any) => {
    try {
      await fetchJson('/api/inventory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemData)
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Find system critical unacknowledged alerts to show in high-prominence top ticker
  const activeUnackCriticalAlert = alerts.find(a => !a.acknowledged && a.severity === 'critical');

  if (!sessionBootstrapped) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-xs">
        Validando sesión...
      </div>
    );
  }

  if (!userSession) {
    if (showLogin) {
      return (
        <LoginForm 
          onLoginSuccess={handleLoginSuccess} 
          onBack={() => setShowLogin(false)} 
        />
      );
    } else {
      return (
        <LandingPage
          onEnterLogin={() => setShowLogin(true)}
        />
      );
    }
  }

  return (
    <div id="nugacore-master" className="min-h-screen bg-slate-950 text-slate-100 flex font-sans overflow-x-hidden selection:bg-indigo-500/30 selection:text-white">
      {/* Sidebar Controller */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        activeAlertsCount={alerts.filter(a => !a.acknowledged).length} 
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        userProfile={userSession}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar: identidad / perfil / logout */}
        <div id="desktop-top-bar" className="hidden md:flex items-center justify-end gap-3 py-2.5 px-6 bg-slate-950 border-b border-slate-900 shrink-0 sticky top-0 z-20">
          <UserMenu profile={userSession} onLogout={handleLogout} />
        </div>

        {/* Mobile Navigation Header */}
        <div id="mobile-navigation-bar" className="md:hidden flex items-center justify-between py-3 px-4 bg-slate-950 border-b border-slate-900 shrink-0 sticky top-0 z-20">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 focus:outline-none transition"
            title="Abrir menú"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            <span className="font-bold text-xs text-white tracking-wide font-sans">NugaCore ERP</span>
          </div>

          <UserMenu profile={userSession} onLogout={handleLogout} />
        </div>

        {/* Aviso RBAC (sin permiso / redirección) */}
        {notice && (
          <div className="bg-amber-950/40 border-b border-amber-900/40 py-2 px-6 text-[11px] text-amber-300 font-mono flex items-center space-x-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {/* Urgent Live Top Notification Slider */}
        {activeUnackCriticalAlert && (
          <div id="urgent-noc-banner" className="bg-rose-950/90 border-b border-rose-850 py-3 px-6 text-xs flex items-center justify-between text-rose-200 z-30 animate-pulse font-mono">
            <div className="flex items-center space-x-3 truncate">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="font-bold uppercase shrink-0">Alerta Crítica:</span>
              <span className="truncate">"<strong>{activeUnackCriticalAlert.source}</strong> - {activeUnackCriticalAlert.message}"</span>
            </div>
            <button
              onClick={handleAcknowledgeAlerts}
              className="ml-4 shrink-0 bg-rose-900/40 border border-rose-800 hover:border-rose-600 hover:text-white px-2.5 py-1 rounded text-[10px] font-bold transition uppercase"
            >
              Silenciar
            </button>
          </div>
        )}

        {/* Global Loading screen */}
        {loading && clients.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 py-20 bg-slate-950 font-mono text-xs">
            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
            <p className="text-slate-500">Accediendo a la base de datos de NugaCore...</p>
          </div>
        ) : errorStr ? (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 py-20 bg-slate-950 font-mono text-xs text-rose-400">
            <AlertTriangle className="w-10 h-10 text-rose-500 animate-pulse" />
            <p className="font-bold">{errorStr}</p>
            <button 
              onClick={handleRefresh}
              className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 rounded hover:bg-slate-850"
            >
              Forzar Re-Conexión REST
            </button>
          </div>
        ) : (
          <main className="flex-1 overflow-y-auto">
            {/* View Dispatcher */}
            {activeTab === 'dashboard' && (
              <Dashboard 
                stats={stats} 
                alerts={alerts}
                onAcknowledgeAlerts={handleAcknowledgeAlerts}
                onRefresh={handleRefresh}
                onPostAlert={handlePostAlert}
                getAuthHeaders={getAuthHeaders}
              />
            )}

            {activeTab === 'crm' && (
              <CrmModule 
                clients={clients} 
                plans={plans} 
                onAddClient={handleAddClient}
                onUpdateClientStatus={handleUpdateClientStatus}
              />
            )}

            {activeTab === 'billing' && (
              <BillingModule
                invoices={invoices}
                clients={clients}
                summary={billingSummary}
                revenueReport={revenueReport}
                userRole={userSession.role}
                onPayInvoice={handlePayInvoice}
                onCreateInvoice={handleCreateInvoice}
                onEditInvoice={handleEditInvoice}
                onFetchAccountState={fetchAccountState}
              />
            )}

            {activeTab === 'network' && (
              <NetworkModule 
                towers={towers} 
                olts={olts} 
                onus={onus} 
                clients={clients}
                naps={naps}
                onToggleTower={handleToggleTower}
                onProvisionOnu={handleProvisionOnu}
                onCreateTower={handleCreateTower}
              />
            )}

            {activeTab === 'mikrotik' && (
              <MikrotikModule
                logs={mikrotikLogs}
                onSendCommand={handleSendCommand}
                onAskCopilot={handleAskCopilot}
                provisionedRouters={provisionedRouters}
                userRole={userSession.role}
                onRefreshRouters={loadProvisionedRouters}
                onCreateRouter={handleCreateRouter}
                onGenerateScript={handleGenerateScript}
                onRotateCredentials={handleRotateCredentials}
                onTestConnection={handleTestConnection}
                workerRuns={workerRuns}
                onRunWorker={handleRunWorker}
                onReadRouter={handleReadRouter}
                onRefreshWorkerRuns={loadWorkerRuns}
                getAuthHeaders={getAuthHeaders}
              />
            )}

            {activeTab === 'routeros-resources' && (
              <RouterOsResourcesModule
                userRole={userSession.role}
                getAuthHeaders={getAuthHeaders}
              />
            )}

            {activeTab === 'routeros-templates' && (
              <RouterOsTemplatesModule
                userRole={userSession.role}
                getAuthHeaders={getAuthHeaders}
              />
            )}

            {activeTab === 'router-enrollment' && (
              <RouterEnrollmentWizard
                userRole={userSession.role}
                getAuthHeaders={getAuthHeaders}
              />
            )}

            {activeTab === 'support' && (
              <SupportModule
                tickets={tickets}
                workOrders={workOrders}
                clients={clients}
                onAddTicket={handleAddTicket}
                onPostTicketMessage={handlePostTicketMessage}
                onUpdateWorkOrderStatus={handleUpdateWorkOrderStatus}
              />
            )}

            {activeTab === 'inventory' && (
              <InventoryModule
                inventory={inventory}
                onMovement={handleInventoryMovement}
                onAddItem={handleAddInventoryItem}
              />
            )}

            {activeTab === 'inventory-routers' && (
              <InventoryRoutersModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'gis' && (
              <GisModule 
                towers={towers} 
                clients={clients}
                naps={naps}
                onus={onus}
                olts={olts}
              />
            )}

            {activeTab === 'wireguard' && (
              <WireguardManagerModule
                servers={wgServers}
                peers={wgPeers}
                onRefresh={loadWireguard}
                onCreateServer={handleCreateWgServer}
                onCreatePeer={handleCreateWgPeer}
                onRotatePeer={handleRotateWgPeer}
                onRevokePeer={handleRevokeWgPeer}
              />
            )}

            {activeTab === 'suspension' && (
              <SuspensionModule
                customers={suspensionCustomers}
                orders={suspensionOrders}
                events={suspensionEvents}
                policy={suspensionPolicy}
                userRole={userSession.role}
                onRefresh={loadSuspension}
                onEvaluateAll={handleEvaluateAllSuspension}
                onEvaluateCustomer={handleEvaluateCustomer}
                onUpdatePolicy={handleUpdateSuspensionPolicy}
              />
            )}

            {activeTab === 'finance' && (
              <FinanceOwnerModule
                key="finance"
                clients={clients}
                invoices={invoices}
                tickets={tickets}
                onAddTicket={handleAddTicket}
                onPayInvoice={handlePayInvoice}
                mode="finance"
              />
            )}

            {activeTab === 'owner' && (
              <FinanceOwnerModule
                key="owner"
                clients={clients}
                invoices={invoices}
                tickets={tickets}
                onAddTicket={handleAddTicket}
                onPayInvoice={handlePayInvoice}
                mode="owner"
              />
            )}

            {activeTab === 'payments' && (
              <div className="p-6">
                <PaymentsModule userRole={userSession.role} />
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
