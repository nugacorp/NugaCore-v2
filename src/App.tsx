import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { clientLog } from './lib/clientLog';
import { lazyWithRetry } from './lib/lazyWithRetry';
import Sidebar from './components/Sidebar';
const Dashboard = lazyWithRetry(() => import('./components/Dashboard'));
const CrmModule = lazyWithRetry(() => import('./components/CrmModule'));
const BillingModule = lazyWithRetry(() => import('./components/BillingModule'));
const NetworkModule = lazyWithRetry(() => import('./components/NetworkModule'));
const MikrotikModule = lazyWithRetry(() => import('./components/MikrotikModule'));
const SupportModule = lazyWithRetry(() => import('./components/SupportModule'));
const InventoryModule = lazyWithRetry(() => import('./components/InventoryModule'));
const WarehousesModule = lazyWithRetry(() => import('./components/WarehousesModule'));
const InventoryTransfersModule = lazyWithRetry(() => import('./components/InventoryTransfersModule'));
const InventoryRoutersModule = lazyWithRetry(() => import('./components/InventoryRoutersModule'));
const NocReadOnlyModule = lazyWithRetry(() => import('./components/NocReadOnlyModule'));
const NocTelemetryModule = lazyWithRetry(() => import('./components/NocTelemetryModule'));
const NocOperationsPanel = lazyWithRetry(() => import('./components/NocOperationsPanel'));
const ManualSafeModeModule = lazyWithRetry(() => import('./modules/manual-safe-mode/ManualSafeModeModule'));
const SafeCommandQueueModule = lazyWithRetry(() => import('./modules/safe-command-queue/SafeCommandQueueModule'));
const ProvisioningCenterModule = lazyWithRetry(() => import('./modules/provisioning/ProvisioningCenterModule'));
const RouterOSReadOnlyModule = lazyWithRetry(() => import('./modules/routeros-readonly/RouterOSReadOnlyModule'));
const UserManualModule = lazyWithRetry(() => import('./modules/user-manual/UserManualModule'));
const InventorySyncModule = lazyWithRetry(() => import('./modules/inventory-sync/InventorySyncModule'));
const GisModule = lazyWithRetry(() => import('./components/GisModule'));
const FinanceOwnerModule = lazyWithRetry(() => import('./components/FinanceOwnerModule'));
const SuspensionModule = lazyWithRetry(() => import('./components/SuspensionModule'));
const WireguardManagerModule = lazyWithRetry(() => import('./components/WireguardManagerModule'));
const RouterOsResourcesModule = lazyWithRetry(() => import('./components/RouterOsResourcesModule'));
const RouterOsTemplatesModule = lazyWithRetry(() => import('./components/RouterOsTemplatesModule'));
const PaymentsModule = lazyWithRetry(() => import('./components/PaymentsModule'));
const CommercialModule = lazyWithRetry(() => import('./components/CommercialModule'));
const ReportsModule = lazyWithRetry(() => import('./components/ReportsModule'));
const PortalModule = lazyWithRetry(() => import('./components/PortalModule'));
const TechPwaModule = lazyWithRetry(() => import('./modules/tech-pwa/TechPwaModule'));
import LoginForm from './components/LoginForm';
import LandingPage from './components/LandingPage';
import RegisterWispForm from './components/RegisterWispForm';
import ResetPasswordForm from './components/ResetPasswordForm';
import WispOnboardingWizard from './components/WispOnboardingWizard';
import IsolatedAppShell from './components/IsolatedAppShell';
import UserMenu from './components/UserMenu';
import TopAlertsBell from './components/TopAlertsBell';
import { authSession, fetchProfileFromBackend, restoreSessionProfileFromSupabase } from './lib/authSession';
import { UserSessionProfile, isSupabaseConfigured, supabase } from './lib/supabase';
import { canAccessTab, getDefaultTabByRole } from './lib/rbac';
import { getAppScope, resolveEntryTab, isIsolatedScope, forcedTabForScope } from './lib/appScope';
import { fetchWithRateLimitBackoff, isApiRateLimitError } from './lib/apiBackoff';

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

import { AlertTriangle, RefreshCw, Menu, Sparkles, ArrowRight } from 'lucide-react';

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'nugacore.sidebar.collapsed.v1';
const WELCOME_BANNER_DISMISSED_KEY = 'nugacore.welcome.dismissed.v1';

interface DashboardStats {
  activeClients: number;
  suspendedClients: number;
  leadsCount: number;
  mrr: number;
  cobranzaMes: number;
  facturacionMes: number;
  activeTickets: number;
  towers: { online: number; warning: number; offline: number };
  oltStats: { connected: number; offlineOnus: number };
  provisioningPending?: number;
}

interface GisMapData {
  clients?: Client[];
  towers?: Tower[];
  olts?: OltFTTH[];
  onus?: OnuFTTH[];
  naps?: NapBox[];
}

// Code splitting (Fase 2 production-ready): cada módulo se carga bajo
// demanda con React.lazy; este fallback se muestra durante la descarga
// del chunk correspondiente.
const ModuleLoader = () => (
  <div className="flex items-center justify-center py-24 text-slate-400 font-mono text-sm">
    Cargando módulo…
  </div>
);

// Reorganización UX (pre PROD-4): el "MikroTik Workspace" in-page agrupa solo
// las funciones de router (core, enrollment, scripts y templates). WireGuard y
// Suspension dejaron de estar anidados aquí: ahora viven en Red y Clientes
// respectivamente y su acceso lo gobierna directamente el RBAC (canAccessTab).
const MIKROTIK_WORKSPACE_TABS = [
  { id: 'mikrotik', label: 'Core' },
  { id: 'router-enrollment', label: 'Enrollment' },
  { id: 'routeros-resources', label: 'Router Scripts' },
  { id: 'routeros-templates', label: 'Router Templates' },
] as const;

const isMikrotikWorkspaceTab = (tabId: string): boolean =>
  MIKROTIK_WORKSPACE_TABS.some(tab => tab.id === tabId);

export default function App() {
  const [showLogin, setShowLogin] = useState<boolean>(false);
  const [showRegister, setShowRegister] = useState<boolean>(false);
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    return path === '/reset-password' || path === '/auth/reset-password';
  });
  const [userSession, setUserSession] = useState<UserSessionProfile | null>(() => authSession.readProfile());
  const [sessionBootstrapped, setSessionBootstrapped] = useState<boolean>(!isSupabaseConfigured);

  // Tab inicial: 'dashboard' por defecto (permitido para todos los roles). Si
  // hay sesión cacheada, se abre en la pantalla de entrada del scope de la PWA
  // (`?app=tech|portal`). El efecto de RBAC corrige si el rol no lo autoriza.
  const [activeTab, setActiveTab] = useState<string>(() => {
    const cached = authSession.readProfile();
    return cached ? resolveEntryTab(cached.role, getAppScope()) : 'dashboard';
  });

  // Alta embebida en Routers (el tab router-enrollment se redirige aquí).
  const [routersOpenEnrollment, setRoutersOpenEnrollment] = useState(false);

  const navigateToTab = useCallback((tab: string) => {
    // Isolated scopes (portal / tech-pwa) may not navigate to other modules
    const forcedTab = forcedTabForScope(getAppScope());
    if (forcedTab !== null && tab !== forcedTab) return;

    if (tab === 'router-enrollment') {
      setRoutersOpenEnrollment(true);
      setActiveTab('inventory-routers');
      return;
    }
    if (tab === 'inventory-routers') {
      setRoutersOpenEnrollment(false);
    }
    setActiveTab(tab);
  }, []);

  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showWelcomeBanner, setShowWelcomeBanner] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WELCOME_BANNER_DISMISSED_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [errorStr, setErrorStr] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [rateLimitNotice, setRateLimitNotice] = useState<string>('');
  const [rateLimitUntilMs, setRateLimitUntilMs] = useState<number>(0);

  const handleLoginSuccess = (profile: UserSessionProfile, accessToken?: string) => {
    setUserSession(profile);
    authSession.save(profile, accessToken);
    setActiveTab(resolveEntryTab(profile.role, getAppScope()));
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
    const client = supabase;
    if (!isSupabaseConfigured || !client) {
      setSessionBootstrapped(true);
      return;
    }

    const { data: authSub } = client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true);
        setShowLogin(false);
        setShowRegister(false);
        setUserSession(null);
        setSessionBootstrapped(true);
      }
    });

    const bootstrap = async () => {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const queryParams = new URLSearchParams(window.location.search);
      const authType = hashParams.get('type') || queryParams.get('type');
      const isRecoveryPath =
        window.location.pathname === '/reset-password'
        || window.location.pathname === '/auth/reset-password'
        || authType === 'recovery';

      if (isRecoveryPath) {
        setPasswordRecoveryMode(true);
        // Deja que Supabase consuma el enlace (PKCE / hash) sin entrar al dashboard.
        await client.auth.getSession();
        if (!mounted) return;
        setUserSession(null);
        authSession.clear();
        setSessionBootstrapped(true);
        return;
      }

      // Enlace de confirmación vencido / inválido: limpia hash y manda a login.
      const authError = hashParams.get('error') || queryParams.get('error');
      const authErrorCode = hashParams.get('error_code') || queryParams.get('error_code');
      if (authError || authErrorCode === 'otp_expired') {
        if (!mounted) return;
        setUserSession(null);
        authSession.clear();
        setShowLogin(true);
        setShowRegister(false);
        setNotice(
          authErrorCode === 'otp_expired'
            ? 'El enlace de confirmación expiró. Inicia sesión y usa «Reenviar confirmación», o registra de nuevo.'
            : 'No se pudo confirmar el correo. Solicita un enlace nuevo desde el login.',
        );
        window.history.replaceState({}, '', '/');
        setSessionBootstrapped(true);
        return;
      }

      const restored = await restoreSessionProfileFromSupabase();
      if (!mounted) return;
      if (restored) {
        setUserSession(restored);
        setActiveTab(resolveEntryTab(restored.role, getAppScope()));
        if (window.location.pathname.startsWith('/auth/')) {
          window.history.replaceState({}, '', '/');
        }
      } else {
        // Sin sesión válida en Supabase: limpiar cualquier perfil cacheado
        // (evita mostrar el dashboard con una sesión obsoleta) -> login.
        setUserSession(null);
        authSession.clear();
      }
      setSessionBootstrapped(true);
    };

    void bootstrap();
    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
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

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore localStorage write failures (private mode / browser policy).
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (showWelcomeBanner) return;
    try {
      localStorage.setItem(WELCOME_BANNER_DISMISSED_KEY, '1');
    } catch {
      // Ignore localStorage write failures (private mode / browser policy).
    }
  }, [showWelcomeBanner]);

  const dismissWelcomeBanner = () => {
    setShowWelcomeBanner(false);
  };

  const startQuickTour = () => {
    if (!userSession) return;
    const preferredTabs = ['network', 'crm', 'support', 'dashboard'];
    const firstAllowedTab = preferredTabs.find(tabId => canAccessTab(userSession.role, tabId)) || getDefaultTabByRole(userSession.role);
    setActiveTab(firstAllowedTab);
    setShowWelcomeBanner(false);
  };

  // DB States
  const [stats, setStats] = useState<DashboardStats>({
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
  // Fase 5.1: sub-tab interna del módulo Inventario ERP (aditiva, sin tocar el sidebar).
  const [inventorySubTab, setInventorySubTab] = useState<'items' | 'warehouses' | 'transfers'>('items');
  const [alerts, setAlerts] = useState<NocAlert[]>([]);
  const [mikrotikLogs, setMikrotikLogs] = useState<RouterSnapshot[]>([]);
  const [naps, setNaps] = useState<NapBox[]>([]);
  const [provisionedRouters, setProvisionedRouters] = useState<MikrotikRouterView[]>([]);
  const [workerRuns, setWorkerRuns] = useState<MikrotikWorkerRun[]>([]);
  const [suspensionCustomers, setSuspensionCustomers] = useState<CustomerServiceView[]>([]);
  const [suspensionOrders, setSuspensionOrders] = useState<SuspensionOrder[]>([]);
  const [suspensionEvents, setSuspensionEvents] = useState<SuspensionEvent[]>([]);
  const [suspensionPolicy, setSuspensionPolicy] = useState<SuspensionPolicy | null>(null);
  const [wgServers, setWgServers] = useState<WireguardServerView[]>([]);
  const [wgPeers, setWgPeers] = useState<WireguardPeerView[]>([]);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
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
      if (userSession.tenantId) {
        headers['x-tenant-id'] = userSession.tenantId;
      }
    }

    return headers;
  }, [userSession]);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const authHeaders = await getAuthHeaders();
    const response = await fetchWithRateLimitBackoff(url, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init?.headers || {}),
      },
    }, {
      key: `${(init?.method || 'GET').toUpperCase()} ${url}`,
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({ error: 'Request failed' })) as { error?: string };
      throw new Error(errPayload.error || `HTTP ${response.status}`);
    }

    // Handle empty body (204 No Content or Content-Length: 0)
    if (
      response.status === 204 ||
      response.headers.get('content-length') === '0'
    ) {
      return undefined as unknown as T;
    }
    const text = await response.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }, [getAuthHeaders]);

  const setRateLimitMessage = useCallback((retryAfterMs: number) => {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    setRateLimitNotice(`Demasiadas solicitudes, reintentando en unos segundos (${seconds}s).`);
    setRateLimitUntilMs(Date.now() + retryAfterMs);
  }, []);

  // Fetch initial system database.
  // Debe ejecutarse solo cuando ya existe una sesión validada: los endpoints
  // protegidos rechazan correctamente cualquier request sin Bearer JWT.
  const fetchData = useCallback(async () => {
    if (!sessionBootstrapped || !userSession) {
      setLoading(false);
      return;
    }

    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      setLoading(false);
      return;
    }

    if (Date.now() < rateLimitUntilMs) {
      setLoading(false);
      return;
    }

    let attemptedFetch = false;
    try {
      setLoading(true);

      // Carga solo el dataset que necesita la vista activa. Antes el shell
      // disparaba ~15 endpoints globales en cada navegación/poll; al abrir varios
      // módulos eso agotaba el rate-limit y producía spam de 429 en consola.
      if (activeTab === 'portal' || getAppScope() === 'portal') {
        attemptedFetch = true;
        try {
          const all = await fetchJson<Client[]>('/api/clients');
          if (getAppScope() === 'portal') {
            try {
              const params = new URLSearchParams(window.location.search);
              const bound = (params.get('client') || params.get('clientId') || '').trim();
              setClients(bound ? all.filter((c) => c.id === bound) : all.slice(0, 1));
            } catch {
              setClients(all.slice(0, 1));
            }
          } else {
            setClients(all);
          }
        } catch {
          setClients([]);
        }
      } else if (activeTab === 'dashboard') {
        attemptedFetch = true;
        const [resStats, resAlerts] = await Promise.all([
          fetchJson<DashboardStats>('/api/dashboard-stats'),
          fetchJson<NocAlert[]>('/api/alerts'),
        ]);
        setStats(resStats);
        setAlerts(resAlerts);
      } else if (activeTab === 'crm') {
        attemptedFetch = true;
        const [resClients, resPlans] = await Promise.all([
          fetchJson<Client[]>('/api/clients'),
          fetchJson<Plan[]>('/api/plans'),
        ]);
        setClients(resClients);
        setPlans(resPlans);
      } else if (activeTab === 'billing') {
        attemptedFetch = true;
        const [resClients, resInvoices, resBillingSummary, resRevenueReport] = await Promise.all([
          fetchJson<Client[]>('/api/clients'),
          fetchJson<Invoice[]>('/api/billing/invoices'),
          fetchJson<BillingAccountSummary>('/api/billing/account-summary'),
          fetchJson<BillingRevenueReport>('/api/billing/revenue-report'),
        ]);
        setClients(resClients);
        setInvoices(resInvoices);
        setBillingSummary(resBillingSummary);
        setRevenueReport(resRevenueReport);
      } else if (activeTab === 'network') {
        attemptedFetch = true;
        const [resClients, resTowers, resOlts, resOnus, resNaps, resRouters] = await Promise.all([
          fetchJson<Client[]>('/api/clients'),
          fetchJson<Tower[]>('/api/network-towers'),
          fetchJson<OltFTTH[]>('/api/olt'),
          fetchJson<OnuFTTH[]>('/api/onu'),
          fetchJson<NapBox[]>('/api/naps'),
          fetchJson<MikrotikRouterView[]>('/api/mikrotik/routers').catch(() => []),
        ]);
        setClients(resClients);
        setTowers(resTowers);
        setOlts(resOlts);
        setOnus(resOnus);
        setNaps(resNaps);
        setProvisionedRouters(resRouters);
      } else if (activeTab === 'support') {
        attemptedFetch = true;
        const [resClients, resTickets, resWorkOrders] = await Promise.all([
          fetchJson<Client[]>('/api/clients'),
          fetchJson<Ticket[]>('/api/tickets'),
          fetchJson<TaskOrder[]>('/api/workorders'),
        ]);
        setClients(resClients);
        setTickets(resTickets);
        setWorkOrders(resWorkOrders);
      } else if (activeTab === 'inventory') {
        attemptedFetch = true;
        setInventory(await fetchJson<WarehouseItem[]>('/api/inventory'));
      } else if (activeTab === 'gis') {
        attemptedFetch = true;
        const mapData = await fetchJson<GisMapData>('/api/gis/map-data');
        setClients(mapData.clients ?? []);
        setTowers(mapData.towers ?? []);
        setOlts(mapData.olts ?? []);
        setOnus(mapData.onus ?? []);
        setNaps(mapData.naps ?? []);
      } else if (activeTab === 'finance' || activeTab === 'owner') {
        attemptedFetch = true;
        const [resClients, resInvoices, resTickets] = await Promise.all([
          fetchJson<Client[]>('/api/clients'),
          fetchJson<Invoice[]>('/api/billing/invoices'),
          fetchJson<Ticket[]>('/api/tickets'),
        ]);
        setClients(resClients);
        setInvoices(resInvoices);
        setTickets(resTickets);
      } else if (isMikrotikWorkspaceTab(activeTab)) {
        attemptedFetch = true;
        try {
          setMikrotikLogs(await fetchJson<RouterSnapshot[]>('/api/mikrotik/logs'));
        } catch {
          setMikrotikLogs([]);
        }
        try {
          setProvisionedRouters(await fetchJson<MikrotikRouterView[]>('/api/mikrotik/routers'));
        } catch {
          setProvisionedRouters([]);
        }
        try {
          setWorkerRuns(await fetchJson<MikrotikWorkerRun[]>('/api/mikrotik/worker/runs'));
        } catch {
          setWorkerRuns([]);
        }
      }

      setErrorStr('');
      setRateLimitNotice('');

      if (activeTab === 'suspension') {
        attemptedFetch = true;
        try {
          const [customers, orders, events, policy] = await Promise.all([
            fetchJson<CustomerServiceView[]>('/api/suspension/customers'),
            fetchJson<SuspensionOrder[]>('/api/suspension/orders'),
            fetchJson<SuspensionEvent[]>('/api/suspension/events'),
            fetchJson<SuspensionPolicy>('/api/suspension/policies'),
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
      }
      if (activeTab === 'wireguard' || routersOpenEnrollment) {
        attemptedFetch = true;
        try {
          const [servers, peers] = await Promise.all([
            fetchJson<WireguardServerView[]>('/api/wireguard/servers'),
            fetchJson<WireguardPeerView[]>('/api/wireguard/peers'),
          ]);
          setWgServers(servers);
          setWgPeers(peers);
        } catch {
          setWgServers([]);
          setWgPeers([]);
        }
      }
    } catch (err) {
      if (isApiRateLimitError(err)) {
        setRateLimitMessage(err.retryAfterMs);
      } else if (attemptedFetch) {
        clientLog.error(err);
        setErrorStr('Error contacting full-stack back-end server REST API.');
      }
    } finally {
      setLoading(false);
    }
  }, [
    sessionBootstrapped,
    userSession,
    activeTab,
    routersOpenEnrollment,
    fetchJson,
    setRateLimitMessage,
    rateLimitUntilMs,
  ]);

  useEffect(() => {
    if (!sessionBootstrapped || !userSession) {
      setLoading(false);
      return;
    }

    // Mientras el wizard WISP está activo no dispares APIs de negocio (403 ONBOARDING_REQUIRED).
    if (userSession.onboardingRequired) {
      setLoading(false);
      return;
    }

    if (!rateLimitNotice && Date.now() >= rateLimitUntilMs) {
      void fetchData();
    }

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (rateLimitNotice) {
        return;
      }
      if (Date.now() < rateLimitUntilMs) {
        return;
      }
      void fetchData();
    }, 120000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !rateLimitNotice && Date.now() >= rateLimitUntilMs) {
        void fetchData();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [sessionBootstrapped, userSession, fetchData, rateLimitNotice, rateLimitUntilMs]);

  useEffect(() => {
    if (!rateLimitNotice) return;
    const remainingMs = Math.max(1000, rateLimitUntilMs - Date.now());
    const t = setTimeout(() => setRateLimitNotice(''), remainingMs);
    return () => clearTimeout(t);
  }, [rateLimitNotice, rateLimitUntilMs]);

  const handleRefresh = async () => {
    await fetchData();
  };

  const refreshAlerts = useCallback(async () => {
    if (!sessionBootstrapped || !userSession) return;
    if (Date.now() < rateLimitUntilMs) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const resAlerts = await fetchJson<NocAlert[]>('/api/alerts');
      setAlerts(resAlerts);
    } catch (err) {
      if (isApiRateLimitError(err)) {
        setRateLimitMessage(err.retryAfterMs);
        return;
      }
      clientLog.error(err);
    }
  }, [sessionBootstrapped, userSession, rateLimitUntilMs, fetchJson, setRateLimitMessage]);

  useEffect(() => {
    if (!sessionBootstrapped || !userSession) return;
    void refreshAlerts();
    const id = window.setInterval(() => {
      void refreshAlerts();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [sessionBootstrapped, userSession, refreshAlerts]);

  const handleAcknowledgeAlerts = async () => {
    try {
      await fetchJson('/api/alerts/acknowledge-all', { method: 'POST' });
      await refreshAlerts();
      if (activeTab === 'dashboard' || activeTab === 'noc') {
        await fetchData();
      }
    } catch (err) {
      clientLog.error(err);
    }
  };

  const handlePostAlert = async (
    type: 'tower' | 'olt' | 'client' | 'system',
    severity: 'critical' | 'warning' | 'info',
    source: string,
    msg: string
  ) => {
    // Simulated live post notification trigger endpoint logic or local append
    clientLog.debug("Post alert: ", type, severity, source, msg);
    await fetchData();
  };

  // CLIENT CRUD CONTROLS
  const handleAddClient = async (newClientData: Record<string, unknown>) => {
    try {
      await fetchJson('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClientData)
      });
      await fetchData();
    } catch (err) {
      clientLog.error(err);
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
      clientLog.error(err);
    }
  };

  const handleDeleteClient = async (id: string) => {
    try {
      await fetchJson(`/api/clients/${id}`, { method: 'DELETE' });
      await fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg, { cause: err });
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
    return fetchJson<AccountStateResponse>(`/api/billing/invoices/${invoiceId}/account-state`);
  };

  // ── MikroTik provisioning (Fase 4.4) ─────────────────────────────────
  // Carga aislada con su propio try/catch: el endpoint excluye a Cobranza,
  // así que un 403 NO debe romper la carga global de datos.
  async function loadProvisionedRouters() {
    try {
      const data = await fetchJson<MikrotikRouterView[]>('/api/mikrotik/routers');
      setProvisionedRouters(data);
    } catch {
      setProvisionedRouters([]);
    }
  }

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
  async function loadWorkerRuns() {
    try {
      setWorkerRuns(await fetchJson('/api/mikrotik/worker/runs'));
    } catch {
      setWorkerRuns([]);
    }
  }

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
  async function loadWireguard() {
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
  }

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
  async function loadSuspension() {
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
  }

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
      clientLog.error(err);
    }
  };

  const handleProvisionOnu = async (onuData: Record<string, unknown>) => {
    try {
      await fetchJson('/api/onu/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onuData)
      });
      await fetchData();
    } catch (err) {
      clientLog.error(err);
    }
  };

  // Errores RELANZADOS para que BillingModule muestre estado de error/éxito.
  const handleCreateInvoice = async (invoiceData: Record<string, unknown>) => {
    await fetchJson('/api/billing/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceData)
    });
    await fetchData();
  };

  const handleEditInvoice = async (id: string, invoiceData: Record<string, unknown>) => {
    await fetchJson(`/api/billing/invoices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceData)
    });
    await fetchData();
  };

  const handleCreateTower = async (towerData: Record<string, unknown>): Promise<Tower> => {
    const created = await fetchJson<Tower>('/api/network-towers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(towerData)
    });
    await fetchData();
    return created;
  };

  const handleCreateMikrotikRouter = async (routerData: Record<string, unknown>): Promise<MikrotikRouterView> => {
    const created = await fetchJson<MikrotikRouterView>('/api/mikrotik/routers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routerData),
    });
    await fetchData();
    return created;
  };

  const handleLinkRouterToTower = async (routerId: string, towerId: string): Promise<void> => {
    await fetchJson(`/api/mikrotik/routers/${encodeURIComponent(routerId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkedTowerId: towerId }),
    });
    await fetchData();
  };

  const handleSaveTowerOnboarding = async (towerId: string, onboarding: Record<string, unknown>): Promise<void> => {
    await fetchJson(`/api/network-towers/${encodeURIComponent(towerId)}/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(onboarding),
    });
  };

  // MIKROTIK COMMAND & AI COPILOT
  const handleSendCommand = async (cmd: string, routerId?: string) => {
    return fetchJson('/api/mikrotik/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, routerId })
    });
  };

  const handleAskCopilot = async (prompt: string, routerContext?: Record<string, unknown>) => {
    return fetchJson<unknown>('/api/mikrotik/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, routerContext })
    });
  };

  // HELPDESK TICKETS & TECH CHECKS
  const handleAddTicket = async (ticketData: Record<string, unknown>) => {
    try {
      await fetchJson('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketData)
      });
      await fetchData();
    } catch (err) {
      clientLog.error(err);
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
      clientLog.error(err);
    }
  };

  const handleUpdateWorkOrderStatus = async (id: string, status: string, signature?: string, checklist?: Record<string, unknown>[]) => {
    try {
      await fetchJson(`/api/workorders/${id}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, signature, checklist })
      });
      await fetchData();
    } catch (err) {
      clientLog.error(err);
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
      clientLog.error(err);
    }
  };

  const handleAddInventoryItem = async (itemData: Record<string, unknown>) => {
    try {
      await fetchJson('/api/inventory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemData)
      });
      await fetchData();
    } catch (err) {
      clientLog.error(err);
    }
  };

  // Find system critical unacknowledged alerts to show in high-prominence top ticker
  const activeUnackCriticalAlert = alerts.find(a => !a.acknowledged && a.severity === 'critical');
  const activeTicketsCount = tickets.filter(t => t.status === 'open' || t.status === 'assigned').length;
  // Routers (inventario + alta embebida) también muestra la franja del workspace.
  const isMikrotikFunctionTab =
    isMikrotikWorkspaceTab(activeTab) || activeTab === 'inventory-routers';
  const mikrotikWorkspaceTabsForRole = userSession
    ? MIKROTIK_WORKSPACE_TABS.filter(tab => canAccessTab(userSession.role, tab.id))
    : [];
  const isSupportWorkspace = activeTab === 'support';
  const shouldShowWelcomeBanner = showWelcomeBanner && activeTab === 'dashboard';

  if (!sessionBootstrapped) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-xs">
        Validando sesión...
      </div>
    );
  }

  if (passwordRecoveryMode) {
    return (
      <ResetPasswordForm
        onDone={async () => {
          setPasswordRecoveryMode(false);
          window.history.replaceState({}, '', '/');
          const restored = await restoreSessionProfileFromSupabase();
          if (restored) {
            handleLoginSuccess(restored);
            return;
          }
          setShowLogin(true);
        }}
        onCancel={() => {
          setPasswordRecoveryMode(false);
          window.history.replaceState({}, '', '/');
          setShowLogin(true);
        }}
      />
    );
  }

  if (!userSession) {
    // Isolated scopes skip LandingPage — go directly to LoginForm
    if (showRegister && !isIsolatedScope(getAppScope())) {
      return (
        <RegisterWispForm
          onBack={() => setShowRegister(false)}
          onGoLogin={() => {
            setShowRegister(false);
            setShowLogin(true);
          }}
        />
      );
    }
    if (showLogin || isIsolatedScope(getAppScope())) {
      return (
        <LoginForm
          onLoginSuccess={handleLoginSuccess}
          onBack={isIsolatedScope(getAppScope()) ? undefined : () => setShowLogin(false)}
          onGoRegister={isIsolatedScope(getAppScope()) ? undefined : () => {
            setShowLogin(false);
            setShowRegister(true);
          }}
        />
      );
    }
    return (
      <LandingPage
        onEnterLogin={() => {
          setShowRegister(false);
          setShowLogin(true);
        }}
        onEnterRegister={() => {
          setShowLogin(false);
          setShowRegister(true);
        }}
      />
    );
  }

  // Onboarding WISP obligatorio (no aplica a portal/tech aislados)
  if (
    userSession.onboardingRequired
    && !isIsolatedScope(getAppScope())
    && (userSession.role === 'Administrador' || userSession.role === 'Super Admin')
  ) {
    return (
      <WispOnboardingWizard
        getAuthHeaders={getAuthHeaders}
        tenantId={userSession.tenantId}
        companyHint={userSession.full_name}
        onCompleted={async () => {
          const token = authSession.readAccessToken();
          const refreshed = token ? await fetchProfileFromBackend(token) : null;
          if (refreshed) {
            setUserSession(refreshed);
            authSession.save(refreshed, token);
          } else {
            setUserSession({ ...userSession, onboardingRequired: false });
          }
        }}
      />
    );
  }

  // Isolated scopes (portal / tech-pwa): render with minimal shell, no Sidebar
  if (isIsolatedScope(getAppScope())) {
    const scope = getAppScope();
    const shellTitle = scope === 'portal' ? 'Portal del Cliente' : 'NugaCore Técnico';
    const shellSubtitle = scope === 'portal' ? 'Consulta tu cuenta y servicio' : 'Gestión de instalaciones y soporte';
    return (
      <IsolatedAppShell
        title={shellTitle}
        subtitle={shellSubtitle}
        profile={userSession}
        onLogout={handleLogout}
      >
        <Suspense fallback={<ModuleLoader />}>
          {scope === 'portal' && (
            <PortalModule
              clients={clients}
              getAuthHeaders={getAuthHeaders}
            />
          )}
          {scope === 'tech' && (
            <TechPwaModule
              getAuthHeaders={getAuthHeaders}
            />
          )}
        </Suspense>
      </IsolatedAppShell>
    );
  }

  return (
    <div id="nugacore-master" className="min-h-screen bg-slate-950 text-slate-100 flex font-sans overflow-x-hidden selection:bg-indigo-500/30 selection:text-white">
      {/* Sidebar Controller */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={navigateToTab} 
        activeAlertsCount={alerts.filter(a => !a.acknowledged).length}
        activeTicketsCount={activeTicketsCount}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(prev => !prev)}
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        userProfile={userSession}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar: bell + perfil a la derecha */}
        {!isSupportWorkspace && (
          <div id="desktop-top-bar" className="hidden md:flex items-center justify-end gap-3 py-2.5 px-6 bg-slate-950 border-b border-slate-900 shrink-0 sticky top-0 z-20">
            <TopAlertsBell
              alerts={alerts}
              onAcknowledgeAll={handleAcknowledgeAlerts}
              onOpenNoc={canAccessTab(userSession.role, 'noc') ? () => navigateToTab('noc') : undefined}
            />
            <UserMenu profile={userSession} onLogout={handleLogout} />
          </div>
        )}

        {/* Mobile Navigation Header */}
        <div id="mobile-navigation-bar" className="md:hidden flex items-center justify-between py-3 px-4 bg-slate-950 border-b border-slate-900 shrink-0 sticky top-0 z-20">
          {/* Left: menu button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 focus:outline-none transition"
            title="Abrir menú"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Center: brand */}
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            <span className="font-bold text-xs text-white tracking-wide font-sans">NugaCore ERP</span>
          </div>

          {/* Right: bell + user menu */}
          <div className="flex items-center gap-1.5">
            <TopAlertsBell
              alerts={alerts}
              onAcknowledgeAll={handleAcknowledgeAlerts}
              onOpenNoc={canAccessTab(userSession.role, 'noc') ? () => navigateToTab('noc') : undefined}
            />
            <UserMenu profile={userSession} onLogout={handleLogout} />
          </div>
        </div>

        {shouldShowWelcomeBanner && (
          <div className="px-4 md:px-6 pt-4">
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-600/10 px-4 py-3.5 md:px-5 md:py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-widest font-mono text-indigo-300/90 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Welcome to NugaCore</span>
                </div>
                <p className="text-sm text-slate-200 mt-1.5 leading-relaxed">
                  Este es tu centro operativo unificado. Navega por Inicio, Clientes y Red para la operación diaria; usa MikroTik para los routers, y Reportes y Sistema para análisis y ajustes. ¿Primera vez? Abre el Manual de Usuario en Sistema.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={startQuickTour}
                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                >
                  <span>Take a Tour</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={dismissWelcomeBanner}
                  className="border border-slate-800 hover:border-slate-700 hover:bg-slate-900 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Aviso RBAC (sin permiso / redirección) */}
        {notice && (
          <div className="bg-amber-950/40 border-b border-amber-900/40 py-2 px-6 text-[11px] text-amber-300 font-mono flex items-center space-x-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {rateLimitNotice && (
          <div className="bg-amber-950/35 border-b border-amber-900/40 py-2 px-6 text-[11px] text-amber-300 font-mono flex items-center space-x-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{rateLimitNotice}</span>
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
            {isMikrotikFunctionTab && (
              <div id="mikrotik-workspace-nav" className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 md:px-6 py-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-mono text-indigo-400/90">MikroTik Workspace</p>
                    <p className="text-xs text-slate-400">Core, Enrollment, Router Scripts y Router Templates consolidados en un mismo módulo operativo.</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {mikrotikWorkspaceTabsForRole.map(tab => {
                      const isActiveWorkspaceTab =
                        activeTab === tab.id ||
                        (tab.id === 'router-enrollment' &&
                          activeTab === 'inventory-routers' &&
                          routersOpenEnrollment);
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => navigateToTab(tab.id)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono border transition ${
                            isActiveWorkspaceTab
                              ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* View Dispatcher */}
            <Suspense fallback={<ModuleLoader />}>
            {activeTab === 'dashboard' && (
              <Dashboard
                stats={stats}
                alerts={alerts}
                onRefresh={handleRefresh}
                getAuthHeaders={getAuthHeaders}
                onNavigate={navigateToTab}
              />
            )}

            {activeTab === 'noc' && (
              <>
                <NocReadOnlyModule getAuthHeaders={getAuthHeaders} />
                <NocTelemetryModule getAuthHeaders={getAuthHeaders} />
                {/* Tooling operativo movido desde el Dashboard Ejecutivo V3
                    (alertas en tiempo real, ping, simulador, umbrales/push, bot). */}
                <NocOperationsPanel
                  stats={stats}
                  alerts={alerts}
                  onAcknowledgeAlerts={handleAcknowledgeAlerts}
                  onRefresh={handleRefresh}
                  onPostAlert={handlePostAlert}
                  getAuthHeaders={getAuthHeaders}
                />
              </>
            )}

            {activeTab === 'manual-safe-mode' && (
              <ManualSafeModeModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'safe-command-queue' && (
              <SafeCommandQueueModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'provisioning' && (
              <ProvisioningCenterModule userRole={userSession.role} getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'routeros-readonly' && (
              <RouterOSReadOnlyModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'user-manual' && (
              <UserManualModule />
            )}

            {activeTab === 'inventory-sync' && (
              <InventorySyncModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'crm' && (
              <CrmModule 
                clients={clients}
                plans={plans}
                onAddClient={handleAddClient}
                onUpdateClientStatus={handleUpdateClientStatus}
                onDeleteClient={handleDeleteClient}
                getAuthHeaders={getAuthHeaders}
                canCreateClient={['Super Admin', 'Administrador', 'Técnico', 'Soporte'].includes(userSession.role)}
                canManageClientLifecycle={['Super Admin', 'Administrador', 'Cobranza'].includes(userSession.role)}
                canDeleteClient={['Super Admin', 'Administrador'].includes(userSession.role)}
                userRole={userSession.role}
                onNavigate={navigateToTab}
              />
            )}

            {activeTab === 'billing' && (
              <BillingModule
                invoices={invoices}
                clients={clients}
                summary={billingSummary}
                revenueReport={revenueReport}
                userRole={userSession.role}
                getAuthHeaders={getAuthHeaders}
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
                provisionedRouters={provisionedRouters}
                onToggleTower={handleToggleTower}
                onProvisionOnu={handleProvisionOnu}
                onCreateTower={handleCreateTower}
                onCreateMikrotikRouter={handleCreateMikrotikRouter}
                onLinkRouterToTower={handleLinkRouterToTower}
                onSaveTowerOnboarding={handleSaveTowerOnboarding}
                getAuthHeaders={getAuthHeaders}
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

            {activeTab === 'support' && (
              <SupportModule
                tickets={tickets}
                workOrders={workOrders}
                clients={clients}
                getAuthHeaders={getAuthHeaders}
                onAddTicket={handleAddTicket}
                onPostTicketMessage={handlePostTicketMessage}
                onUpdateWorkOrderStatus={handleUpdateWorkOrderStatus}
              />
            )}

            {activeTab === 'inventory' && (
              <div>
                {/* Fase 5.1: tira de sub-tabs aditiva del Inventario ERP. */}
                <div className="bg-slate-900 px-6 pt-6">
                  <div className="inline-flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
                    {([
                      ['items', 'Artículos'],
                      ['warehouses', 'Almacenes'],
                      ['transfers', 'Transferencias'],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        id={`inventory-subtab-${key}`}
                        onClick={() => setInventorySubTab(key)}
                        className={`px-3 py-1.5 text-xs font-mono rounded-lg transition ${
                          inventorySubTab === key ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {inventorySubTab === 'items' && (
                  <InventoryModule
                    inventory={inventory}
                    onMovement={handleInventoryMovement}
                    onAddItem={handleAddInventoryItem}
                  />
                )}
                {inventorySubTab === 'warehouses' && (
                  <WarehousesModule getAuthHeaders={getAuthHeaders} />
                )}
                {inventorySubTab === 'transfers' && (
                  <InventoryTransfersModule getAuthHeaders={getAuthHeaders} />
                )}
              </div>
            )}

            {(activeTab === 'inventory-routers' || activeTab === 'router-enrollment') && (
              <InventoryRoutersModule
                userRole={userSession.role}
                getAuthHeaders={getAuthHeaders}
                panel={
                  activeTab === 'router-enrollment' || routersOpenEnrollment
                    ? 'enrollment'
                    : 'inventory'
                }
                onPanelChange={(panel) => {
                  setRoutersOpenEnrollment(panel === 'enrollment');
                  setActiveTab('inventory-routers');
                }}
              />
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
                getAuthHeaders={getAuthHeaders}
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
                getAuthHeaders={getAuthHeaders}
                onAddTicket={handleAddTicket}
                onPayInvoice={handlePayInvoice}
                mode="owner"
              />
            )}

            {activeTab === 'commercial' && (
              <CommercialModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'reports' && (
              <ReportsModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'portal' && (
              <PortalModule clients={clients} getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'tech-pwa' && (
              <TechPwaModule getAuthHeaders={getAuthHeaders} />
            )}

            {activeTab === 'payments' && (
              <div className="p-6">
                <PaymentsModule
                  userRole={userSession.role}
                  getAuthHeaders={getAuthHeaders}
                />
              </div>
            )}
            </Suspense>
          </main>
        )}
      </div>
    </div>
  );
}
