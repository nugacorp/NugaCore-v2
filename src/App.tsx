import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import CrmModule from './components/CrmModule';
import BillingModule from './components/BillingModule';
import NetworkModule from './components/NetworkModule';
import MikrotikModule from './components/MikrotikModule';
import SupportModule from './components/SupportModule';
import InventoryModule from './components/InventoryModule';
import GisModule from './components/GisModule';

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
  NapBox
} from './types';

import { Cpu, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorStr, setErrorStr] = useState<string>('');

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
  const [towers, setTowers] = useState<Tower[]>([]);
  const [olts, setOlts] = useState<OltFTTH[]>([]);
  const [onus, setOnus] = useState<OnuFTTH[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [workOrders, setWorkOrders] = useState<TaskOrder[]>([]);
  const [inventory, setInventory] = useState<WarehouseItem[]>([]);
  const [alerts, setAlerts] = useState<NocAlert[]>([]);
  const [mikrotikLogs, setMikrotikLogs] = useState<any[]>([]);
  const [naps, setNaps] = useState<NapBox[]>([]);

  // Fetch initial system database
  const fetchData = async () => {
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
        resNaps
      ] = await Promise.all([
        fetch('/api/dashboard-stats').then(r => r.json()),
        fetch('/api/clients').then(r => r.json()),
        fetch('/api/plans').then(r => r.json()),
        fetch('/api/billing/invoices').then(r => r.json()),
        fetch('/api/network-towers').then(r => r.json()),
        fetch('/api/olt').then(r => r.json()),
        fetch('/api/onu').then(r => r.json()),
        fetch('/api/tickets').then(r => r.json()),
        fetch('/api/workorders').then(r => r.json()),
        fetch('/api/inventory').then(r => r.json()),
        fetch('/api/alerts').then(r => r.json()),
        fetch('/api/mikrotik/logs').then(r => r.json()),
        fetch('/api/naps').then(r => r.json())
      ]);

      setStats(resStats);
      setClients(resClients);
      setPlans(resPlans);
      setInvoices(resInvoices);
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
    } catch (err: any) {
      console.error(err);
      setErrorStr('Error contacting full-stack back-end server REST API.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto polling for live real-time NOC metrics & alarms
    const timer = setInterval(() => {
      fetchData();
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = async () => {
    await fetchData();
  };

  const handleAcknowledgeAlerts = async () => {
    try {
      await fetch('/api/alerts/acknowledge-all', { method: 'POST' });
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
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClientData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateClientStatus = async (id: string, status: 'active' | 'suspended' | 'baja') => {
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // BILLING TRANSAC CONTROLS
  const handlePayInvoice = async (invoiceId: string, method: string) => {
    try {
      const res = await fetch(`/api/billing/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method })
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // TECHNICAL INFRASTRUCTURE CONTROLS
  const handleToggleTower = async (id: string) => {
    try {
      const res = await fetch(`/api/network-towers/${id}/toggle-state`, {
        method: 'POST'
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleProvisionOnu = async (onuData: any) => {
    try {
      const res = await fetch('/api/onu/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onuData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateInvoice = async (invoiceData: any) => {
    try {
      const res = await fetch('/api/billing/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditInvoice = async (id: string, invoiceData: any) => {
    try {
      const res = await fetch(`/api/billing/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateTower = async (towerData: any) => {
    try {
      const res = await fetch('/api/network-towers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(towerData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // MIKROTIK COMMAND & AI COPILOT
  const handleSendCommand = async (cmd: string, routerId?: string) => {
    const res = await fetch('/api/mikrotik/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, routerId })
    });
    return res.json();
  };

  const handleAskCopilot = async (prompt: string, routerContext?: any) => {
    const res = await fetch('/api/mikrotik/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, routerContext })
    });
    return res.json();
  };

  // HELPDESK TICKETS & TECH CHECKS
  const handleAddTicket = async (ticketData: any) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePostTicketMessage = async (id: string, text: string) => {
    try {
      const res = await fetch(`/api/tickets/${id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWorkOrderStatus = async (id: string, status: string, signature?: string, checklist?: any[]) => {
    try {
      const res = await fetch(`/api/workorders/${id}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, signature, checklist })
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ERP ACTIVE MOVEMENTS
  const handleInventoryMovement = async (itemId: string, type: 'in' | 'out' | 'transfer', qty: number, toWarehouse?: string) => {
    try {
      const res = await fetch('/api/inventory/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, type, qty, toWarehouse })
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddInventoryItem = async (itemData: any) => {
    try {
      const res = await fetch('/api/inventory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemData)
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Find system critical unacknowledged alerts to show in high-prominence top ticker
  const activeUnackCriticalAlert = alerts.find(a => !a.acknowledged && a.severity === 'critical');

  return (
    <div id="nugacore-master" className="min-h-screen bg-slate-950 text-slate-100 flex font-sans overflow-x-hidden selection:bg-indigo-500/30 selection:text-white">
      {/* Sidebar Controller */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        activeAlertsCount={alerts.filter(a => !a.acknowledged).length} 
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
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
                onPayInvoice={handlePayInvoice}
                onCreateInvoice={handleCreateInvoice}
                onEditInvoice={handleEditInvoice}
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

            {activeTab === 'gis' && (
              <GisModule 
                towers={towers} 
                clients={clients}
              />
            )}
          </main>
        )}
      </div>
    </div>
  );
}
