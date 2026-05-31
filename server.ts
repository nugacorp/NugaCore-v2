import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { Client, Plan, Tower, OltFTTH, OnuFTTH, Ticket, TaskOrder, WarehouseItem, Invoice, NocAlert } from "./src/types";

// Initialize Gemini Client safely
let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("WARNING: GEMINI_API_KEY is not defined. AI Copilot will use fallback responses.");
    }
    geminiClient = new GoogleGenAI({
      apiKey: key || "PLACEHOLDER_KEY",
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return geminiClient;
}

const app = express();
app.use(express.json());

// In-Memory Database State
const PLANS: Plan[] = [
  { id: 'plan-basic', name: 'Nuga Residencial 20M', speedMbpsDown: 20, speedMbpsUp: 5, price: 299, type: 'PPPoE' },
  { id: 'plan-plus', name: 'Nuga Residencial 50M', speedMbpsDown: 50, speedMbpsUp: 10, price: 449, type: 'PPPoE' },
  { id: 'plan-ultra', name: 'Nuga Residencial 100M', speedMbpsDown: 100, speedMbpsUp: 20, price: 699, type: 'PPPoE' },
  { id: 'plan-corp-small', name: 'Nuga Empresarial 100M Dedicado', speedMbpsDown: 100, speedMbpsUp: 100, price: 2499, type: 'Static' },
  { id: 'plan-corp-gig', name: 'Nuga Corp Giga Simétrico', speedMbpsDown: 1000, speedMbpsUp: 1000, price: 11999, type: 'Static' },
];

let CLIENTS: Client[] = [
  { id: 'c-1', name: 'Sofia Rodriguez Mendoza', type: 'residential', status: 'active', email: 'sofia.rodriguez@email.com', phone: '5512345678', address: 'Av. Insurgentes Sur 1204', city: 'CDMX', lat: 19.3891, lng: -99.1783, planId: 'plan-plus', ip: '10.100.10.12', mac: 'BC:E6:7C:12:34:56', pppoeUser: 'sofia_rodriguez_nuga', pppoePassword: 'pass_sofiarod_99', contractId: 'CONT-2026-103', documents: [{ name: 'INE', url: '#', date: '2026-01-10' }, { name: 'Comp_Domicilio', url: '#', date: '2026-01-10' }], installationPhotos: [], installationDate: '2026-01-12' },
  { id: 'c-2', name: 'Corporativo Reforma S.A.', type: 'corporate', status: 'active', email: 'it@reforma.com', phone: '5576543210', address: 'Paseo de la Reforma 250', city: 'CDMX', lat: 19.4273, lng: -99.1676, planId: 'plan-corp-small', ip: '192.168.200.4', mac: '00:15:6D:EE:AA:11', contractId: 'CONT-2026-104', installationDate: '2026-01-15' },
  { id: 'c-3', name: 'Hotel Vista Hermosa', type: 'hotel', status: 'active', email: 'gerencia@hotelvista.om', phone: '7449876543', address: 'Costera Miguel Alemán 405', city: 'Acapulco', lat: 16.8534, lng: -99.8821, planId: 'plan-corp-gig', ip: '10.100.40.2', mac: '44:D9:E7:AA:BB:CC', contractId: 'CONT-2026-105', installationDate: '2026-02-01' },
  { id: 'c-4', name: 'Rodrigo Flores Ortiz', type: 'residential', status: 'suspended', email: 'rodrigo.flores@email.com', phone: '5587654321', address: 'Calle 10, Col. San Pedro de los Pinos', city: 'CDMX', lat: 19.3908, lng: -99.1895, planId: 'plan-basic', ip: '10.100.10.45', mac: 'BC:E6:7C:99:A1:C2', pppoeUser: 'rodrigo_flores_nuga', pppoePassword: 'pw_rodrigo_f123', contractId: 'CONT-2026-118' },
  { id: 'c-5', name: 'Escuela Primaria Benito Juárez', type: 'school', status: 'active', email: 'directora@bjprimaria.edu.mx', phone: '5544332211', address: 'Calle Juarez s/n, Col. Centro', city: 'CDMX', lat: 19.4125, lng: -99.1555, planId: 'plan-plus', ip: '10.100.10.88', mac: 'E0:3F:49:FF:22:98' },
  { id: 'c-lead-1', name: 'Mario Moreno Cantinflas', type: 'residential', status: 'lead', email: 'mario.moreno@cantinflas.org', phone: '5522119933', address: 'Plaza Garibaldi 12', city: 'CDMX', lat: 19.4412, lng: -99.1394, planId: 'plan-plus', ip: '0.0.0.0', notes: 'Interesado en internet residencial. Factibilidad aprobada del Sector Norte. Espera asignación de técnico.' },
  { id: 'c-lead-2', name: 'Restaurante El Cardenal', type: 'corporate', status: 'lead', email: 'administracion@elcardenal.mx', phone: '5544998811', address: 'Calle de la Palma 23', city: 'CDMX', lat: 19.4348, lng: -99.1332, planId: 'plan-corp-small', ip: '0.0.0.0', notes: 'Requiere enlace simétrico para terminales punto de venta y Wi-Fi para clientes.' }
];

let TOWERS: Tower[] = [
  { id: 't-1', name: 'Torre del Valle (Norte)', status: 'online', lat: 19.3912, lng: -99.1712, height: 45, coverageRadiusKm: 5, ip: '10.0.1.1', cpu: 32, ram: 45, tempCelsius: 38, pingMs: 8, uptime: '45d 12h 30m', ports: [{ port: 'eth1 (WAN)', status: 'up', speed: '1 Gbps' }, { port: 'eth2 (SFP)', status: 'up', speed: '10 Gbps' }, { port: 'eth3 (Sector Norte)', status: 'up', speed: '100 Mbps' }, { port: 'eth4 (Sector Sur)', status: 'up', speed: '100 Mbps' }], equipment: [{ name: 'RB5009UG+S+OUT', type: 'Router principal', brand: 'MikroTik' }, { name: 'Rocket5 AC Prism', type: 'Sectorial AP 5Ghz', brand: 'Ubiquiti' }, { name: 'Cambium ePMP 3000', type: 'AP Sectorial', brand: 'Cambium Networks' }] },
  { id: 't-2', name: 'Repetidor San Pedro', status: 'online', lat: 19.3854, lng: -99.1910, height: 25, coverageRadiusKm: 3, ip: '10.0.1.2', cpu: 14, ram: 28, tempCelsius: 32, pingMs: 14, uptime: '12d 4h 15m', ports: [{ port: 'eth1 (Uplink)', status: 'up', speed: '1 Gbps' }, { port: 'eth2 (Local AP)', status: 'up', speed: '100 Mbps' }], equipment: [{ name: 'PowerBeam 5AC Gen2', type: 'Enlace Punto a Punto', brand: 'Ubiquiti' }, { name: 'EdgeRouter 12', type: 'Router Local', brand: 'Ubiquiti' }] },
  { id: 't-3', name: 'Torre Ajusco (Sur-Master)', status: 'warning', lat: 19.2985, lng: -99.2132, height: 60, coverageRadiusKm: 15, ip: '10.0.1.3', cpu: 78, ram: 82, tempCelsius: 52, pingMs: 24, uptime: '158d 1h 5m', ports: [{ port: 'eth1 (WAN Fiber)', status: 'up', speed: '10 Gbps' }, { port: 'eth2', status: 'up', speed: '1 Gbps' }, { port: 'eth3 (Sector Poniente)', status: 'up', speed: '100 Mbps' }], equipment: [{ name: 'CCR2116-12G-4S+', type: 'Router Core', brand: 'MikroTik' }, { name: 'Mimosa A5c', type: 'Access Point Quad-Sector', brand: 'Mimosa' }] }
];

let OLTS: OltFTTH[] = [
  { id: 'olt-1', name: 'OLT Centro Huawei MA5800', status: 'online', brand: 'Huawei', ip: '10.200.1.1', portsCount: 16, onusConnected: 124, onusLimit: 1024, splitters: [{ id: 'splt-1', ratio: '1:64', fiberLine: 1, occupied: 45 }, { id: 'splt-2', ratio: '1:64', fiberLine: 2, occupied: 62 }, { id: 'splt-3', ratio: '1:32', fiberLine: 3, occupied: 17 }] }
];

let ONUS: OnuFTTH[] = [
  { id: 'onu-1', clientId: 'c-1', clientName: 'Sofia Rodriguez Mendoza', oltId: 'olt-1', port: 1, mac: 'HWTC:A1:B2:C3:44', signalDb: -19.5, status: 'online', brand: 'Huawei', model: 'EG8145V5' },
  { id: 'onu-2', clientId: 'c-5', clientName: 'Escuela Primaria Benito Juárez', oltId: 'olt-1', port: 2, mac: 'HWTC:FE:11:22:90', signalDb: -22.3, status: 'online', brand: 'Huawei', model: 'EG8010H' }
];

let TICKETS: Ticket[] = [
  { id: 'tk-1', clientName: 'Rodrigo Flores Ortiz', clientId: 'c-4', title: 'Servicio suspendido tras pago realizado', description: 'El cliente reporta que pagó hace 3 horas por transferencia bancaria, pero sigue saliendo el portal de cobro en su navegador. Solicita reactivación.', category: 'Facturacion', severity: 'medium', status: 'open', slaHours: 4, created: '2026-05-31 01:22', messages: [{ sender: 'Cliente', message: 'Ya pagué mi recibo del mes de Mayo, por favor reactiven el servicio.', date: '2026-05-31 01:22' }] },
  { id: 'tk-2', clientName: 'Hotel Vista Hermosa', clientId: 'c-3', title: 'Paquetes perdidos en enlace dedicado', description: 'Departamento de TI del hotel reporta pérdida de paquetes de un 8% detectada en su monitoreo. El ping a la IP pública fluctúa entre 15ms y 240ms.', category: 'Internet', severity: 'high', status: 'assigned', slaHours: 2, technicianId: 'tech-1', created: '2026-05-30 18:45', messages: [{ sender: 'IT Hotel', message: 'Monitoreamos ping alto y paquetes caídos, de favor coordinen con soporte de segundo nivel.', date: '2026-05-30 18:45' }] }
];

let WORK_ORDERS: TaskOrder[] = [
  { id: 'wo-1', title: 'Instalación nueva alta residencial', type: 'installation', clientName: 'Mario Moreno Cantinflas', clientId: 'c-lead-1', address: 'Plaza Garibaldi 12, CDMX', phone: '5522119933', notes: 'Instalación estándar. Cruzar cable drop por poste izquierdo. Dejar router configurado en modo PPPoE con usuario mario_cantinflas.', date: '2026-06-01', technicianName: 'Juan Pérez (Principal)', status: 'pending', checklist: [{ item: 'Factibilidad física y nivel de señal drop (-18dB a -25dB)', done: false }, { item: 'Fijación de herraje tensor y cable drop', done: false }, { item: 'Fusión de fibra e instalación de roseta', done: false }, { item: 'Aprovisionamiento de la ONU', done: false }, { item: 'Prueba de ping y velocidad de subida/bajada', done: false }, { item: 'Firma de conformidad de cliente', done: false }] },
  { id: 'wo-2', title: 'Reubicación de antena CPE por arbolado', type: 'reallocation', clientName: 'Rodrigo Flores Ortiz', clientId: 'c-4', address: 'Calle 10, de los Pinos, CDMX', phone: '5587654321', notes: 'El cliente reporta reubicación ya que crecieron árboles enfrente de la visual a Torre del Valle.', date: '2026-05-31', technicianName: 'Carlos Gomez (Instalador Jr)', status: 'in_progress', checklist: [{ item: 'Evaluar nueva ubicación con mástil de 3m', done: true }, { item: 'Montaje de antena Ubiquiti LiteBeam', done: true }, { item: 'Alineación de señal (esperado < -65dBm)', done: false }, { item: 'Validación de tráfico y ping constante', done: false }] }
];

let INVENTORY: WarehouseItem[] = [
  { id: 'item-1', name: 'LiteBeam 5AC Gen2', category: 'CPE', model: 'LBE-5AC-Gen2', brand: 'Ubiquiti', qty: 45, warehouse: 'Principal', serials: ['LBE5AC0011', 'LBE5AC0012', 'LBE5AC0013'] },
  { id: 'item-2', name: 'hEX lite Router', category: 'Router', model: 'RB750r2', brand: 'MikroTik', qty: 12, warehouse: 'Principal', serials: ['HEX7509A', 'HEX7509B'] },
  { id: 'item-3', name: 'Bobina Fibra Drop 1 Hilo SM (1km)', category: 'Fiber', model: 'Drop-SM-1H-1000', brand: 'NugaFiber', qty: 8, warehouse: 'Principal', serials: ['FIBER-DP-9012', 'FIBER-DP-9013'] },
  { id: 'item-4', name: 'ONU GPON AC1200 Wi-Fi', category: 'CPE', model: 'EG8145V5', brand: 'Huawei', qty: 24, warehouse: 'Coche Tecnico 1', serials: ['HWTCA12B34C1', 'HWTCA12B34C2'] },
  { id: 'item-5', name: 'Switch PoE 24 Puertos L2', category: 'Switch', model: 'ES-24-250W', brand: 'Ubiquiti', qty: 2, warehouse: 'Torre Alfa', serials: ['ES24P250W01'] }
];

let INVOICES: Invoice[] = [
  { id: 'fac-101', clientId: 'c-1', clientName: 'Sofia Rodriguez Mendoza', amount: 449, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'paid', cfdiStatus: 'generated', cfdiUuid: '3F1A4BC2-9904-4F54-AD0B-883F217A3BB1', items: [{ description: 'Servicio de Internet Resiliente 50M - Mes Mayo 2026', price: 449, qty: 1 }], payments: [{ date: '2026-05-05 10:30', amount: 449, method: 'Stripe', transactionId: 'ch_3Mv2h9LkdJUws0X32a8Xj' }] },
  { id: 'fac-102', clientId: 'c-2', clientName: 'Corporativo Reforma S.A.', amount: 2499, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'paid', cfdiStatus: 'generated', cfdiUuid: '99CC3B24-8D03-12FC-77AA-9081273FFBA0', items: [{ description: 'Enlace Dedicado Simétrico 100M - Mayo 2026', price: 2499, qty: 1 }], payments: [{ date: '2026-05-08 14:15', amount: 2499, method: 'SPEI', transactionId: 'SPEI88921013a2' }] },
  { id: 'fac-103', clientId: 'c-4', clientName: 'Rodrigo Flores Ortiz', amount: 299, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'unpaid', cfdiStatus: 'pending', items: [{ description: 'Servicio de Internet Resiliente 20M - Mes Mayo 2026', price: 299, qty: 1 }], payments: [] },
  { id: 'fac-104', clientId: 'c-3', clientName: 'Hotel Vista Hermosa', amount: 11999, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'paid', cfdiStatus: 'generated', cfdiUuid: 'FF123984-AAA-BBBB-CCCC-DDDD12456', items: [{ description: 'Súper Enlace Giga Simétrico - Mayo 2026', price: 11999, qty: 1 }], payments: [{ date: '2026-05-09 09:12', amount: 11999, method: 'PayPal', transactionId: 'pay_99FF0123' }] },
  { id: 'fac-105', clientId: 'c-5', clientName: 'Escuela Primaria Benito Juárez', amount: 449, dateStr: '2026-05-01', dueDateStr: '2026-05-10', status: 'overdue', cfdiStatus: 'pending', items: [{ description: 'Servicio de Internet Resiliente 50M - Mes Mayo 2026', price: 449, qty: 1 }], payments: [] }
];

let NOC_ALERTS: NocAlert[] = [
  { id: 'alt-1', source: 'Torre Ajusco (Sur-Master)', sourceType: 'tower', severity: 'warning', message: 'Temperatura de CPU elevada a 52°C. Carga del ventilador al 90%.', timestamp: '2026-05-31 02:40', acknowledged: false },
  { id: 'alt-2', source: 'Rodrigo Flores Ortiz', sourceType: 'client', severity: 'critical', message: 'Cliente suspendido por falta de pago detectará portal cautivo (IP 10.100.10.45).', timestamp: '2026-05-31 03:00', acknowledged: true }
];

// RouterOS Commands Logs Simulation
let MIKROTIK_LOGS = [
  { timestamp: '2026-05-31 03:30:12', message: 'pppoe,info pppoe-in-sofia_rodriguez: logged in' },
  { timestamp: '2026-05-31 03:31:00', message: 'script,info AutoSuspension trigger: user rodrigo_flores_nuga disabled, queue deactivated' },
  { timestamp: '2026-05-31 03:35:15', message: 'system,info,account user admin logged in from 10.0.0.101 via winbox' },
  { timestamp: '2026-05-31 03:39:50', message: 'interface,info SFP port Link-Up speed 10Gbps full-duplex' },
];

// UTILITIES
function createAlert(type: 'tower' | 'olt' | 'client' | 'system', severity: 'critical' | 'warning' | 'info', source: string, message: string) {
  const newAlert: NocAlert = {
    id: 'alt-' + Date.now(),
    source,
    sourceType: type,
    severity,
    message,
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
    acknowledged: false
  };
  NOC_ALERTS.unshift(newAlert);
}

// REST ENDPOINTS

// 1. STATS
app.get("/api/dashboard-stats", (req, res) => {
  const activeCount = CLIENTS.filter(c => c.status === 'active').length;
  const suspendedCount = CLIENTS.filter(c => c.status === 'suspended').length;
  const leadsCount = CLIENTS.filter(c => c.status === 'lead').length;
  const totalMrr = CLIENTS.reduce((acc, c) => {
    if (c.status === 'active' || c.status === 'suspended') {
      const plan = PLANS.find(p => p.id === c.planId);
      return acc + (plan ? plan.price : 0);
    }
    return acc;
  }, 0);

  const monthCobranza = INVOICES.filter(f => f.status === 'paid').reduce((acc, f) => acc + f.amount, 0);
  const monthFacturacion = INVOICES.reduce((acc, f) => acc + f.amount, 0);
  
  const onlineTowers = TOWERS.filter(t => t.status === 'online').length;
  const warningsTowers = TOWERS.filter(t => t.status === 'warning').length;
  const offlineTowers = TOWERS.filter(t => t.status === 'offline').length;

  res.json({
    activeClients: activeCount,
    suspendedClients: suspendedCount,
    leadsCount,
    mrr: totalMrr,
    cobranzaMes: monthCobranza,
    facturacionMes: monthFacturacion,
    activeTickets: TICKETS.filter(t => t.status !== 'resolved' && t.status !== 'closed').length,
    towers: { online: onlineTowers, warning: warningsTowers, offline: offlineTowers },
    oltStats: { connected: ONUS.filter(o => o.status === 'online').length, offlineOnus: ONUS.filter(o => o.status !== 'online').length }
  });
});

// 2. CLIENTS & LEADS
app.get("/api/clients", (req, res) => {
  res.json(CLIENTS);
});

app.post("/api/clients", (req, res) => {
  const { name, type, email, phone, address, city, planId, lat, lng, isConvertLead, leadId, notes } = req.body;
  
  if (isConvertLead && leadId) {
    CLIENTS = CLIENTS.filter(c => c.id !== leadId);
    createAlert('client', 'info', name, `Lead convertido exitosamente a Cliente.`);
  }

  const randomSub = Math.floor(Math.random() * 253) + 2;
  const newClient: Client = {
    id: 'c-' + (CLIENTS.length + 10),
    name,
    type,
    status: isConvertLead ? 'active' : 'lead',
    email: email || 'sin-correo@nuga.core',
    phone: phone || '',
    address: address || '',
    city: city || 'CDMX',
    lat: Number(lat) || 19.4125,
    lng: Number(lng) || -99.1555,
    planId: planId || 'plan-basic',
    ip: isConvertLead ? `10.100.10.${randomSub}` : '0.0.0.0',
    mac: isConvertLead ? `00:1A:79:A1:BA:${randomSub.toString(16).toUpperCase().padStart(2, '0')}` : undefined,
    pppoeUser: isConvertLead ? `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_nuga` : undefined,
    pppoePassword: isConvertLead ? 'NugaSecretPass' : undefined,
    contractId: isConvertLead ? `CONT-2026-${120 + CLIENTS.length}` : undefined,
    installationDate: isConvertLead ? new Date().toISOString().substring(0, 10) : undefined,
    notes: notes || ''
  };

  CLIENTS.push(newClient);

  if (isConvertLead) {
    // Generate Invoice Automatically
    const plan = PLANS.find(p => p.id === newClient.planId);
    const cost = plan ? plan.price : 449;
    const newInvoice: Invoice = {
      id: 'fac-' + (120 + INVOICES.length),
      clientId: newClient.id,
      clientName: newClient.name,
      amount: cost,
      dateStr: new Date().toISOString().substring(0, 10),
      dueDateStr: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      status: 'unpaid',
      cfdiStatus: 'pending',
      items: [{ description: `Cargo de instalación y mensualidad anticipada - Plan ${plan?.name || 'Contrato'}`, price: cost, qty: 1 }],
      payments: []
    };
    INVOICES.push(newInvoice);

    // Create a new ONU provisioned representation
    if (newClient.type === 'residential' || newClient.type === 'school') {
      const newOnu: OnuFTTH = {
        id: 'onu-' + (ONUS.length + 10),
        clientId: newClient.id,
        clientName: newClient.name,
        oltId: 'olt-1',
        port: 1,
        mac: `HWTCA${randomSub}BBCC`,
        signalDb: -20.5,
        status: 'online',
        brand: 'Huawei',
        model: 'EG8145V5'
      };
      ONUS.push(newOnu);
    }

    // Add log
    MIKROTIK_LOGS.push({
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      message: `pppoe,info AutoProvisioning done for PPP clientSecret ${newClient.pppoeUser}`
    });
  }

  res.json(newClient);
});

// Update client state (for Suspension / Reactivación)
app.put("/api/clients/:id", (req, res) => {
  const { id } = req.params;
  const index = CLIENTS.findIndex(c => c.id === id);
  if (index !== -1) {
    CLIENTS[index] = { ...CLIENTS[index], ...req.body };
    
    // Log RouterOS effect
    if (req.body.status === 'suspended') {
      MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `script,info Core Router Suspended PPPoE: ${CLIENTS[index].pppoeUser || id} block address list active`
      });
      createAlert('client', 'warning', CLIENTS[index].name, 'Línea de cliente automáticamente SUSPENDIDA en el Router Core por falta de pago.');
    } else if (req.body.status === 'active') {
      MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `script,info Core Router Reactivated PPPoE: ${CLIENTS[index].pppoeUser || id} unblocked address list`
      });
      createAlert('client', 'info', CLIENTS[index].name, 'Línea de cliente REACTIVADA con éxito en MikroTik con velocidad completa.');
    }

    res.json(CLIENTS[index]);
  } else {
    res.status(404).json({ error: "Customer not found" });
  }
});

// 3. TOOWERS / NETWORKING
app.get("/api/network-towers", (req, res) => {
  res.json(TOWERS);
});

// Simulate Tower Control Actions (Reboot / Faults toggling)
app.post("/api/network-towers/:id/toggle-state", (req, res) => {
  const { id } = req.params;
  const tower = TOWERS.find(t => t.id === id);
  if (tower) {
    if (tower.status === 'online' || tower.status === 'warning') {
      tower.status = 'offline';
      tower.cpu = 0;
      tower.ram = 0;
      tower.pingMs = -1;
      createAlert('tower', 'critical', tower.name,`¡ATENCIÓN! La torre ${tower.name} ha dejado de reportar pings (Enlace caído).`);
      
      // Affect clients whose GPS coverage lands here
      MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `system,error OSPF Link failure to ${tower.ip} - peer unreachable`
      });
    } else {
      tower.status = 'online';
      tower.cpu = 25;
      tower.ram = 40;
      tower.pingMs = 12;
      createAlert('tower', 'info', tower.name, `Conexión reestablecida con éxito de la torre ${tower.name}.`);
    }
    res.json(tower);
  } else {
    res.status(404).json({ error: "Tower node and telemetry core not found." });
  }
});

// FTTH GPON PROVISIONING
app.get("/api/olt", (req, res) => res.json(OLTS));
app.get("/api/onu", (req, res) => res.json(ONUS));

app.post("/api/onu/provision", (req, res) => {
  const { clientId, oltId, port, mac, brand, model } = req.body;
  const client = CLIENTS.find(c => c.id === clientId);
  if (!client) {
    return res.status(400).json({ error: "Invalid client" });
  }

  const newOnu: OnuFTTH = {
    id: 'onu-' + (ONUS.length + 11),
    clientId,
    clientName: client.name,
    oltId: oltId || 'olt-1',
    port: Number(port) || 1,
    mac: mac || 'HWTC:DE:AD:BE:EF',
    signalDb: -21.8,
    status: 'online',
    brand: brand || 'Huawei',
    model: model || 'ONU Dual-Band'
  };

  ONUS.push(newOnu);
  res.json(newOnu);
});

// 4. BILLING & INVOICES
app.get("/api/billing/invoices", (req, res) => {
  res.json(INVOICES);
});

app.post("/api/billing/invoices/:id/pay", (req, res) => {
  const { id } = req.params;
  const { method } = req.body;
  const invoice = INVOICES.find(f => f.id === id);
  if (invoice) {
    invoice.status = 'paid';
    invoice.cfdiStatus = 'generated';
    invoice.cfdiUuid = '4F17A9B9-' + Math.floor(Math.random() * 9000 + 1000) + '-4EF2-BD44-FFBBAA123' + Math.floor(Math.random() * 90 + 10);
    invoice.payments.push({
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      amount: invoice.amount,
      method: method || 'Transferencia',
      transactionId: 'TXN_' + Math.random().toString(36).substring(3, 11).toUpperCase()
    });

    // Auto-reactivate client if suspended!
    const client = CLIENTS.find(c => c.id === invoice.clientId);
    if (client && client.status === 'suspended') {
      client.status = 'active';
      MIKROTIK_LOGS.push({
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `script,info Automations Flow: billing payment success of ${invoice.id} triggers reactivate customer state for ${client.pppoeUser}`
      });
      createAlert('client', 'info', client.name, `Pago recibido vía ${method}. Cuenta reactivada automáticamente a velocidad completa.`);
    }

    res.json(invoice);
  } else {
    res.status(404).json({ error: "Invoice ledger not found" });
  }
});

// 5. HELPDESK TICKETS & TECH WORK ORDERS
app.get("/api/tickets", (req, res) => res.json(TICKETS));

app.post("/api/tickets", (req, res) => {
  const { clientId, title, description, category, severity } = req.body;
  const client = CLIENTS.find(c => c.id === clientId);
  
  const newTicket: Ticket = {
    id: 'tk-' + (TICKETS.length + 10),
    clientName: client ? client.name : 'Cliente Genérico',
    clientId,
    title,
    description,
    category: category || 'Internet',
    severity: severity || 'medium',
    status: 'open',
    slaHours: severity === 'critical' ? 1 : severity === 'high' ? 4 : 24,
    created: new Date().toISOString().replace('T', ' ').substring(0, 16),
    messages: [{ sender: 'Cliente', message: description, date: new Date().toISOString().replace('T', ' ').substring(0, 16) }]
  };

  TICKETS.unshift(newTicket);
  createAlert('system', 'warning', newTicket.clientName, `Nuevo ticket soporte: ${title}`);
  res.json(newTicket);
});

// Reply on Ticket
app.post("/api/tickets/:id/message", (req, res) => {
  const { id } = req.params;
  const { message, sender } = req.body;
  const ticket = TICKETS.find(t => t.id === id);
  if (ticket) {
    ticket.messages.push({
      sender: sender || 'Soporte NugaCore',
      message,
      date: new Date().toISOString().replace('T', ' ').substring(0, 16)
    });
    res.json(ticket);
  } else {
    res.status(404).json({ error: "Ticket not found" });
  }
});

app.get("/api/workorders", (req, res) => res.json(WORK_ORDERS));

app.post("/api/workorders/:id/update-status", (req, res) => {
  const { id } = req.params;
  const { status, signature, checklist } = req.body;
  const order = WORK_ORDERS.find(w => w.id === id);
  if (order) {
    order.status = status;
    if (signature) order.signature = signature;
    if (checklist) order.checklist = checklist;

    if (status === 'completed') {
      const client = CLIENTS.find(c => c.id === order.clientId);
      if (client && client.status === 'lead') {
        client.status = 'active';
        client.installationDate = new Date().toISOString().substring(0, 10);
        
        // Setup initial client info on Mikrotik and ONU
        client.ip = `10.100.10.${Math.floor(Math.random() * 200) + 10}`;
        client.mac = `00:E0:4C:D1:A1:${Math.floor(Math.random() * 90) + 10}`;
        client.pppoeUser = `${client.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_nuga`;
        client.pppoePassword = 'DefaultSecurePassword';
        
        createAlert('client', 'info', client.name, `Instalación física concretada por Técnico. Servicio activo.`);
      }
    }
    res.json(order);
  } else {
    res.status(404).json({ error: "Work order not found" });
  }
});

// 6. INVENTORY
app.get("/api/inventory", (req, res) => res.json(INVENTORY));

app.post("/api/inventory/movement", (req, res) => {
  const { itemId, type, qty, toWarehouse } = req.body; // type: 'in' | 'out' | 'transfer'
  const item = INVENTORY.find(i => i.id === itemId);
  if (item) {
    if (type === 'in') {
      item.qty += Number(qty);
    } else if (type === 'out') {
      if (item.qty >= Number(qty)) {
        item.qty -= Number(qty);
      } else {
        return res.status(400).json({ error: "Insufficient stock" });
      }
    } else if (type === 'transfer') {
      if (item.qty >= Number(qty)) {
        item.qty -= Number(qty);
        // Add to destination warehouse or find existing
        const destItem = INVENTORY.find(i => i.name === item.name && i.warehouse === toWarehouse);
        if (destItem) {
          destItem.qty += Number(qty);
        } else {
          INVENTORY.push({
            id: 'item-' + Date.now(),
            name: item.name,
            category: item.category,
            model: item.model,
            brand: item.brand,
            qty: Number(qty),
            warehouse: toWarehouse,
            serials: []
          });
        }
      } else {
        return res.status(400).json({ error: "Insufficient stock for transfer" });
      }
    }
    res.json(INVENTORY);
  } else {
    res.status(404).json({ error: "Inventory item not found" });
  }
});

// 7. ALERTS (NOC FEED)
app.get("/api/alerts", (req, res) => res.json(NOC_ALERTS));

app.post("/api/alerts/acknowledge-all", (req, res) => {
  NOC_ALERTS.forEach(a => a.acknowledged = true);
  res.json(NOC_ALERTS);
});

// 8. MIKROTIK SIMULATION LOGS
app.get("/api/mikrotik/logs", (req, res) => {
  res.json(MIKROTIK_LOGS);
});

// Run raw RouterOS Commands Simulation
app.post("/api/mikrotik/command", (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "No query command" });

  let output = "";
  const cmd = command.trim();

  if (cmd.startsWith("/ip address print")) {
    output = `Flags: D - dynamic, X - disabled, I - invalid, A - active
 #   ADDRESS            NETWORK         INTERFACE
 0   10.100.1.1/24      10.100.1.0      ether1-WAN
 1   192.168.10.1/24    192.168.10.0    ether3-LAN
 2   10.100.10.1/24     10.100.10.0     vlan10-Clientes`;
  } else if (cmd.startsWith("/ppp active print")) {
    output = `Flags: R - running
 #   NAME                      SERVICE   CALLER-ID         ADDRESS         UPTIME
 0 R sofia_rodriguez_nuga      pppoe     BC:E6:7C:12:34:56  10.100.10.12    05:42:19
 1 R school_benito_juarez_nuga pppoe     E0:3F:49:FF:22:98  10.100.10.88    22:11:05`;
  } else if (cmd.startsWith("/queue simple print")) {
    output = `Flags: X - disabled, I - invalid, D - dynamic
 #      NAME                               RATE         LIMIT-AT      MAX-LIMIT
 0  D   sofia_rodriguez_nuga_limit        1.2M/15.4M   10M/50M       10M/50M
 1  D   school_benito_juarez_nuga_limit   512k/4.1M    2M/20M        2M/20M
 2  X   rodrigo_flores_nuga_suspended     0/0          1M/1M         512k/512k`;
  } else if (cmd.includes("reboot")) {
    output = "System is rebooting... Connection lost";
  } else {
    output = `Command executed successfully on WISP Core.
Output: [RouterOS v7.14.2 Core]
Script trigger OK. Modified address-list counters.`;
  }

  MIKROTIK_LOGS.push({
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    message: `user,info Admin console ran: "${command}"`
  });

  res.json({ output });
});

// 9. GEMINI IA MIKROTIK COPILOT
app.post("/api/mikrotik/copilot", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  try {
    const aiInstance = getGemini();
    const systemInstruction = `
      Eres el NugaCore Copiloto IA, un experto mundial en administración de MikroTik RouterOS v6, v7, redes GPON/EPON y soporte técnico para WISPs (Internet Service Providers).
      Ayudas a técnicos de campo a proveer configuraciones limpias, scripts seguros de suspensión, queues simples (Simple Queues), queues hijas, túneles PPPoE, Hotspots, cortes automáticos, y diagnóstico avanzado de latencia/pérdida de paquetes.
      
      Reglas de respuesta:
      - Responde con un tono altamente técnico, profesional y pragmático para un administrador de red de telecomunicaciones.
      - Cuando se solicite un script RouterOS, proporciónalo en bloques de código limpios con comentarios útiles.
      - Mantén explicaciones concisas. Enfócate directamente en la solución técnica.
      - Si el prompt incluye un diagnóstico (ej: un cliente con señal de -28dBm de fibra o IP con pérdida de paquetes), da el checklist exacto para que el técnico lo resuelva en la antena, OLT o conector.
    `;

    const response = await aiInstance.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.3,
      }
    });

    res.json({ text: response.text });
  } catch (err: any) {
    console.error("Gemini Copilot Error:", err);
    // Dynamic helpful fallback for sandbox environment without API Keys
    res.json({ 
      text: `### NugaCore [FALLBACK COPILOTT]
No se pudo comunicar con el modelo de IA debido a que el API Key no está configurado (o es incorrecto). No obstante, aquí tienes un Script RouterOS pre-generado estándar para tu petición:

\`\`\`routeros
# Script de suspensión automatizada NugaCore WISP
/queue simple {
  set [find name="rodrigo_flores_nuga_suspended"] max-limit=128k/128k comment="SUSPENDIDO_FALTA_DE_PAGO"
}
/ip firewall address-list {
  add list=SUSPENDIDOS address=10.100.10.45 comment="RODRIGO_FLORES_CORTE_AUTO"
}
# Redirigir tráfico HTTP al Portal de Suspensión de NugaCore
/ip firewall nat {
  add action=dst-nat chain=dstnat dst-port=80,443 protocol=tcp src-address-list=SUSPENDIDOS to-addresses=192.168.10.1 to-ports=3000
}
\`\`\`
*Para habilitar las respuestas contextuales ilimitadas del Copiloto Gemini v3.5, introduce tu \`GEMINI_API_KEY\` en el panel de **Secrets > Settings**.*`
    });
  }
});

// GET PLANS FOR CLIENT FORMS
app.get("/api/plans", (req, res) => res.json(PLANS));

// VITE WEB APPLICATION LOADER FLOW
async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    // Development middleware Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production client serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[NugaCore Server] running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
}

startServer();
