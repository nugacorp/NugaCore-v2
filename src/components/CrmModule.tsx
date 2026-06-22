import React, { useCallback, useEffect, useState } from 'react';
import { 
  Users, 
  UserPlus, 
  Search, 
  MapPin, 
  CheckCircle, 
  AlertTriangle, 
  TrendingUp, 
  UserMinus, 
  Briefcase, 
  Mail, 
  Phone, 
  FileText, 
  Image,
  ArrowRight,
  Network,
  ScanLine,
  ShieldCheck,
  XCircle,
  Loader2,
  PackageCheck,
  Crosshair
} from 'lucide-react';
import { Client, Plan } from '../types';
import {
  canSubmitCustomerOnboarding,
  IpAssignmentValidation,
  ipStatusLabel,
  ipStatusMessage,
  isValidIpv4Input,
} from '../lib/ipamView';
import {
  areValidCoordinates,
  capacityToneClasses,
  isValidLatitudeInput,
  isValidLongitudeInput,
} from '../lib/wispOnboardingView';

interface IpamRouterView {
  id: string;
  name: string;
  kind: 'router' | 'tower';
  description: string;
}

interface IpamPoolView {
  id: string;
  routerId: string;
  name: string;
  cidr: string;
  gateway: string;
  reservedIps: string[];
}

interface AvailableIpsResponse {
  routerId: string;
  poolId: string;
  cidr: string;
  totalAvailable: number;
  ips: string[];
}

interface RouterCapacityView {
  routerId: string;
  routerName: string;
  totalCapacity: number;
  activeClients: number;
  freeCapacity: number;
  utilizationPercent: number;
}

interface CoverageView {
  distanceKm: number;
  azimuth: number;
  estimatedCoverage: number;
  status: 'GOOD' | 'WARNING' | 'POOR';
}

interface CustomerEquipmentView {
  id: string;
  kind: 'CPE' | 'POE' | 'POWER_SUPPLY';
  name: string;
  brand: string;
  model: string;
  availableQty: number;
  serials: string[];
}

interface EquipmentReservationView {
  id: string;
  equipmentId: string;
  equipmentName: string;
  serial: string;
  mac: string;
  customerLabel: string;
  status: 'RESERVED';
  createdAt: string;
}

interface CrmModuleProps {
  clients: Client[];
  plans: Plan[];
  onAddClient: (newClientData: any) => Promise<void>;
  onUpdateClientStatus: (id: string, status: 'active' | 'suspended' | 'baja') => Promise<void>;
  getAuthHeaders: () => Promise<Record<string, string>>;
  canCreateClient: boolean;
  canManageClientLifecycle: boolean;
}

export default function CrmModule({
  clients,
  plans,
  onAddClient,
  onUpdateClientStatus,
  getAuthHeaders,
  canCreateClient,
  canManageClientLifecycle,
}: CrmModuleProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<any>('residential');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formPlanId, setFormPlanId] = useState('');
  const [formLat, setFormLat] = useState('19.4125');
  const [formLng, setFormLng] = useState('-99.1555');
  const [formNotes, setFormNotes] = useState('');
  const [formConnectionType, setFormConnectionType] = useState<'WISP' | 'FTTH'>('WISP');
  const [ipamRouters, setIpamRouters] = useState<IpamRouterView[]>([]);
  const [ipamPools, setIpamPools] = useState<IpamPoolView[]>([]);
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [formRouterId, setFormRouterId] = useState('');
  const [formPoolId, setFormPoolId] = useState('');
  const [formAssignedIp, setFormAssignedIp] = useState('');
  const [ipEntryMode, setIpEntryMode] = useState<'select' | 'manual'>('select');
  const [ipValidation, setIpValidation] = useState<IpAssignmentValidation | null>(null);
  const [ipamLoading, setIpamLoading] = useState(false);
  const [ipamError, setIpamError] = useState('');
  const [routerCapacity, setRouterCapacity] = useState<RouterCapacityView | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [coverage, setCoverage] = useState<CoverageView | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState('');
  const [customerEquipment, setCustomerEquipment] = useState<CustomerEquipmentView[]>([]);
  const [formEquipmentId, setFormEquipmentId] = useState('');
  const [formEquipmentSerial, setFormEquipmentSerial] = useState('');
  const [formEquipmentMac, setFormEquipmentMac] = useState('');
  const [equipmentReservation, setEquipmentReservation] = useState<EquipmentReservationView | null>(null);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentError, setEquipmentError] = useState('');
  const [isLeadForm, setIsLeadForm] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const selectedPool = ipamPools.find((pool) => pool.id === formPoolId) || null;
  const selectedEquipment = customerEquipment.find((item) => item.id === formEquipmentId) || null;
  const coordinatesValid = areValidCoordinates(formLat, formLng);
  const canConfirmAdd = coordinatesValid && canSubmitCustomerOnboarding({
    name: formName,
    isLead: isLeadForm,
    routerId: formRouterId,
    poolId: formPoolId,
    assignedIp: formAssignedIp,
    validation: ipValidation,
  });

  const resetNetworkAssignment = useCallback(() => {
    setIpamPools([]);
    setAvailableIps([]);
    setFormRouterId('');
    setFormPoolId('');
    setFormAssignedIp('');
    setIpEntryMode('select');
    setIpValidation(null);
    setIpamError('');
    setRouterCapacity(null);
    setCoverage(null);
    setCoverageError('');
  }, []);

  const fetchIpamJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(url, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `IPAM respondió HTTP ${response.status}`);
    }
    return await response.json() as T;
  }, [getAuthHeaders]);

  const loadIpamRouters = useCallback(async () => {
    setIpamLoading(true);
    setIpamError('');
    try {
      setIpamRouters(await fetchIpamJson<IpamRouterView[]>('/api/ipam/routers'));
    } catch (error) {
      setIpamRouters([]);
      setIpamError(error instanceof Error ? error.message : 'No se pudieron cargar routers IPAM.');
    } finally {
      setIpamLoading(false);
    }
  }, [fetchIpamJson]);

  const loadCustomerEquipment = useCallback(async () => {
    setEquipmentLoading(true);
    setEquipmentError('');
    try {
      setCustomerEquipment(
        await fetchIpamJson<CustomerEquipmentView[]>('/api/inventory/customer-equipment'),
      );
    } catch (error) {
      setCustomerEquipment([]);
      setEquipmentError(error instanceof Error ? error.message : 'No se pudo cargar equipo disponible.');
    } finally {
      setEquipmentLoading(false);
    }
  }, [fetchIpamJson]);

  useEffect(() => {
    if (!showAddForm) return;
    if (ipamRouters.length === 0) void loadIpamRouters();
    if (customerEquipment.length === 0) void loadCustomerEquipment();
  }, [
    showAddForm,
    ipamRouters.length,
    customerEquipment.length,
    loadIpamRouters,
    loadCustomerEquipment,
  ]);

  const handleRouterSelection = async (routerId: string) => {
    setFormRouterId(routerId);
    setFormPoolId('');
    setFormAssignedIp('');
    setAvailableIps([]);
    setIpValidation(null);
    setIpamError('');
    setRouterCapacity(null);
    setCoverage(null);
    setCoverageError('');
    if (!routerId) {
      setIpamPools([]);
      return;
    }

    setIpamLoading(true);
    try {
      const [pools, capacity] = await Promise.all([
        fetchIpamJson<IpamPoolView[]>(`/api/ipam/routers/${encodeURIComponent(routerId)}/pools`),
        fetchIpamJson<RouterCapacityView>(`/api/ipam/routers/${encodeURIComponent(routerId)}/capacity`),
      ]);
      setIpamPools(pools);
      setFormPoolId(pools[0]?.id || '');
      setRouterCapacity(capacity);
    } catch (error) {
      setIpamPools([]);
      setIpamError(error instanceof Error ? error.message : 'No se pudieron cargar pools IPAM.');
    } finally {
      setIpamLoading(false);
    }
  };

  const checkCoverage = useCallback(async (
    latitude = formLat,
    longitude = formLng,
    routerId = formRouterId,
  ) => {
    setCoverageError('');
    setCoverage(null);
    if (!routerId) {
      setCoverageError('Selecciona un router o torre para calcular cobertura.');
      return;
    }
    if (!areValidCoordinates(latitude, longitude)) {
      setCoverageError('Captura una latitud y longitud válidas.');
      return;
    }

    setCoverageLoading(true);
    try {
      const params = new URLSearchParams({
        routerId,
        latitude: String(latitude),
        longitude: String(longitude),
      });
      setCoverage(await fetchIpamJson<CoverageView>(`/api/coverage/check?${params.toString()}`));
    } catch (error) {
      setCoverageError(error instanceof Error ? error.message : 'No se pudo estimar la cobertura.');
    } finally {
      setCoverageLoading(false);
    }
  }, [fetchIpamJson, formLat, formLng, formRouterId]);

  const handleGetCurrentLocation = () => {
    setGpsMessage('');
    setGpsError('');
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocalización no disponible en este navegador.');
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude.toFixed(6);
        const longitude = position.coords.longitude.toFixed(6);
        setFormLat(latitude);
        setFormLng(longitude);
        setGpsMessage('GPS capturado correctamente.');
        setGpsLoading(false);
        if (formRouterId) void checkCoverage(latitude, longitude, formRouterId);
      },
      () => {
        setGpsError('No fue posible obtener la ubicación actual. Puedes capturarla manualmente.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const handleReserveEquipment = async () => {
    setEquipmentError('');
    setEquipmentReservation(null);
    if (!formName.trim()) {
      setEquipmentError('Captura el nombre del cliente antes de reservar equipo.');
      return;
    }
    if (!formEquipmentId || !formEquipmentSerial || !formEquipmentMac.trim()) {
      setEquipmentError('Selecciona equipo, serie y captura la MAC.');
      return;
    }

    setEquipmentLoading(true);
    try {
      setEquipmentReservation(
        await fetchIpamJson<EquipmentReservationView>(
          '/api/inventory/customer-equipment/reservations',
          {
            method: 'POST',
            body: JSON.stringify({
              equipmentId: formEquipmentId,
              serial: formEquipmentSerial,
              mac: formEquipmentMac,
              customerLabel: formName,
            }),
          },
        ),
      );
    } catch (error) {
      setEquipmentError(error instanceof Error ? error.message : 'No se pudo reservar el equipo.');
    } finally {
      setEquipmentLoading(false);
    }
  };

  const validateAssignedIp = useCallback(async (ip: string): Promise<IpAssignmentValidation | null> => {
    const normalizedIp = ip.trim();
    if (!formRouterId) {
      const validation: IpAssignmentValidation = {
        routerId: '',
        poolId: formPoolId,
        ip: normalizedIp,
        status: 'invalid',
        available: false,
        message: 'Selecciona router antes de asignar IP.',
      };
      setIpValidation(validation);
      return validation;
    }
    if (!formPoolId) {
      const validation: IpAssignmentValidation = {
        routerId: formRouterId,
        poolId: '',
        ip: normalizedIp,
        status: 'invalid',
        available: false,
        message: 'Selecciona un pool o segmento antes de asignar IP.',
      };
      setIpValidation(validation);
      return validation;
    }
    if (!isValidIpv4Input(normalizedIp)) {
      const validation: IpAssignmentValidation = {
        routerId: formRouterId,
        poolId: formPoolId,
        ip: normalizedIp,
        status: 'invalid',
        available: false,
        message: 'IP inválida. Escribe una dirección IPv4 válida.',
      };
      setIpValidation(validation);
      return validation;
    }

    setIpamLoading(true);
    setIpamError('');
    try {
      const validation = await fetchIpamJson<IpAssignmentValidation>('/api/ipam/validate-ip', {
        method: 'POST',
        body: JSON.stringify({
          routerId: formRouterId,
          poolId: formPoolId,
          ip: normalizedIp,
        }),
      });
      setIpValidation(validation);
      return validation;
    } catch (error) {
      setIpValidation(null);
      setIpamError(error instanceof Error ? error.message : 'No se pudo validar la IP.');
      return null;
    } finally {
      setIpamLoading(false);
    }
  }, [fetchIpamJson, formPoolId, formRouterId]);

  useEffect(() => {
    if (ipEntryMode !== 'manual' || !formAssignedIp) return;
    const timer = setTimeout(() => {
      void validateAssignedIp(formAssignedIp);
    }, 350);
    return () => clearTimeout(timer);
  }, [formAssignedIp, ipEntryMode, validateAssignedIp]);

  const handleScanAvailableIps = async () => {
    if (!formRouterId) {
      setIpValidation({
        routerId: '',
        poolId: formPoolId,
        ip: formAssignedIp,
        status: 'invalid',
        available: false,
        message: 'Selecciona router antes de asignar IP.',
      });
      return;
    }
    if (!formPoolId) {
      setIpamError('Selecciona un pool o segmento antes de escanear.');
      return;
    }

    setIpamLoading(true);
    setIpamError('');
    try {
      const result = await fetchIpamJson<AvailableIpsResponse>(
        `/api/ipam/pools/${encodeURIComponent(formPoolId)}/available-ips`,
      );
      setAvailableIps(result.ips);
      if (result.ips.length === 0) setIpamError('No hay IPs disponibles en este segmento.');
    } catch (error) {
      setAvailableIps([]);
      setIpamError(error instanceof Error ? error.message : 'No se pudieron escanear IPs.');
    } finally {
      setIpamLoading(false);
    }
  };

  // Filter lists
  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (c.phone && c.phone.includes(searchTerm));
    const matchesType = filterType === 'all' || c.type === filterType;
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGpsError('');
    if (!coordinatesValid) {
      setGpsError('Latitud o longitud inválida.');
      return;
    }
    if (!canConfirmAdd) return;

    let finalValidation = ipValidation;
    if (!isLeadForm) {
      finalValidation = await validateAssignedIp(formAssignedIp);
      if (!finalValidation?.available) return;
    }

    await onAddClient({
      name: formName,
      type: formType,
      email: formEmail,
      phone: formPhone,
      address: formAddress,
      city: formCity,
      planId: formPlanId || plans[0]?.id || 'plan-basic',
      connectionType: formConnectionType,
      lat: Number(formLat),
      lng: Number(formLng),
      notes: formNotes,
      status: isLeadForm ? 'lead' : 'active',
      routerId: formRouterId || undefined,
      poolId: formPoolId || undefined,
      assignedIp: formAssignedIp.trim() || undefined,
      ipAssignmentStatus: finalValidation?.status,
      equipmentReservationId: equipmentReservation?.id,
      mac: equipmentReservation?.mac || formEquipmentMac.trim() || undefined,
      isConvertLead: false
    });

    // Reset Form
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormAddress('');
    setFormPlanId('');
    setFormNotes('');
    setFormConnectionType('WISP');
    setGpsMessage('');
    setGpsError('');
    setFormEquipmentId('');
    setFormEquipmentSerial('');
    setFormEquipmentMac('');
    setEquipmentReservation(null);
    setEquipmentError('');
    resetNetworkAssignment();
    setShowAddForm(false);
  };

  const handleConvertLead = async (lead: Client) => {
    await onAddClient({
      name: lead.name,
      type: lead.type,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      city: lead.city,
      planId: lead.planId || plans[0]?.id || 'plan-basic',
      connectionType: lead.connectionType || 'FTTH',
      lat: lead.lat,
      lng: lead.lng,
      notes: lead.notes,
      isConvertLead: true,
      leadId: lead.id
    });
    setSelectedClient(null);
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Header Bento style */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">CRM Clientes & Leads NugaCore</h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Gestión completa de suscriptores residenciales, corporativos, gobierno y embudo de ventas de prospectos.
          </p>
        </div>
        {canCreateClient && (
          <button
            onClick={() => {
              setIsLeadForm(false);
              setShowAddForm(true);
            }}
            id="add-customer-btn"
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition shadow-lg shadow-indigo-500/10 self-start"
          >
            <UserPlus className="w-4 h-4" />
            <span>Alta Nuevo Cliente</span>
          </button>
        )}
      </div>

      {/* Main Grid: Filters on Left (or lists), details on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Clients List (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-4">
            {/* Search and Filters */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Buscar cliente por nombre, email o teléfono..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-2 focus:outline-none"
                >
                  <option value="all">Tipos (Todos)</option>
                  <option value="residential">Residencial</option>
                  <option value="corporate">Corporativo</option>
                  <option value="government">Gobierno</option>
                  <option value="hotel">Hoteles</option>
                  <option value="school">Escuelas</option>
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-2 focus:outline-none"
                >
                  <option value="all">Estatus (Todos)</option>
                  <option value="active">Activo</option>
                  <option value="suspended">Suspendido</option>
                  <option value="lead">Prospecto (Lead)</option>
                  <option value="baja">Baja</option>
                </select>
              </div>
            </div>

            {/* List Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 text-slate-500 font-mono uppercase">
                    <th className="py-3 px-2">Cliente / Tipo</th>
                    <th className="py-3 px-2">Estatus</th>
                    <th className="py-3 px-2">IP & Plan</th>
                    <th className="py-3 px-2">Ciudad</th>
                    <th className="py-3 px-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {filteredClients.map((client, idx) => {
                    const plan = plans.find(p => p.id === client.planId);
                    return (
                      <tr 
                        key={`${client.id}-${idx}`}
                        id={`crm-client-row-${client.id}`}
                        onClick={() => setSelectedClient(client)}
                        className={`hover:bg-slate-900/60 transition cursor-pointer ${
                          selectedClient?.id === client.id ? 'bg-slate-900/90' : ''
                        }`}
                      >
                        <td className="py-3 px-2">
                          <div className="flex items-center space-x-1.5 flex-wrap">
                            <span className="font-semibold text-white text-sm">{client.name}</span>
                            {client.connectionType === 'FTTH' ? (
                              <span className="bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 text-[8px] px-1.5 py-0.2 rounded font-mono uppercase font-black uppercase">FTTH Fibra</span>
                            ) : (
                              <span className="bg-amber-500/15 text-amber-400 border border-amber-500/25 text-[8px] px-1.5 py-0.2 rounded font-mono uppercase font-black uppercase">WISP Radio</span>
                            )}
                          </div>
                          <div className="text-slate-500 flex items-center space-x-1 font-mono uppercase text-[9px] mt-0.5">
                            <span>{client.type}</span>
                            <span>•</span>
                            <span className="text-slate-400 font-sans normal-case">{client.email}</span>
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          {client.status === 'active' && (
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                              Activo
                            </span>
                          )}
                          {client.status === 'suspended' && (
                            <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 font-mono font-bold px-2 py-0.5 rounded text-[10px] uppercase animate-pulse">
                              Suspendido
                            </span>
                          )}
                          {client.status === 'lead' && (
                            <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 font-mono font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                              Prospecto
                            </span>
                          )}
                          {client.status === 'baja' && (
                            <span className="bg-slate-800 text-slate-500 border border-slate-700 font-mono px-2 py-0.5 rounded text-[10px] uppercase">
                              Baja
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2 font-mono">
                          <div className="text-slate-300 font-semibold">{plan?.name || 'Ninguno'}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {(client.assignedIp || client.ip) !== '0.0.0.0'
                              ? (client.assignedIp || client.ip)
                              : 'Sin IP'}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-slate-400">{client.city}</td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            {canManageClientLifecycle && client.status === 'suspended' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateClientStatus(client.id, 'active');
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[9px] font-bold px-2 py-1 rounded-md transition uppercase tracking-wider shadow-lg animate-pulse"
                              >
                                Reactivar
                              </button>
                            )}
                            <button
                              id={`crm-view-btn-${client.id}`}
                              className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded border border-slate-700 transition"
                            >
                              Inspeccionar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-500 font-mono">
                        No se encontraron clientes con el criterio seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Client Detail Sidebar / Actions (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {selectedClient ? (
            <div id="crm-detail-pane" className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-6">
              <div className="flex items-start justify-between border-b border-slate-900 pb-4">
                <div>
                  <span className="text-[9px] font-mono tracking-widest uppercase bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded border border-indigo-500/20">
                    Ficha Cliente
                  </span>
                  <h3 className="text-lg font-bold text-white mt-2 leading-tight">{selectedClient.name}</h3>
                  <p className="text-[11px] font-mono text-slate-500 mt-1 uppercase">ID: {selectedClient.id}</p>
                </div>
                <button 
                  onClick={() => setSelectedClient(null)} 
                  className="text-slate-500 hover:text-white font-bold"
                >
                  ✕
                </button>
              </div>

              {/* CRM Info List */}
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3 bg-slate-900/40 p-3.5 rounded-2xl border border-slate-900">
                  <div>
                    <span className="text-slate-500 block uppercase text-[9px] font-mono">Contrato</span>
                    <span className="font-semibold">{selectedClient.contractId || 'No Emitido'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase text-[9px] font-mono">Tecnología</span>
                    <span className="font-semibold text-indigo-400">{selectedClient.connectionType === 'FTTH' ? 'FTTH Fibra' : 'WISP Radio'}</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center space-x-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{selectedClient.email}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{selectedClient.phone || 'Sin número'}</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>{selectedClient.address}, {selectedClient.city}</span>
                  </div>
                </div>

                {/* GPS Geoloc */}
                <div>
                  <span className="text-slate-500 block uppercase text-[9px] font-mono mb-1">Geolocalización GPS</span>
                  <div className="bg-slate-900/60 p-2.5 rounded-xl text-[10px] font-mono flex items-center justify-between border border-slate-920">
                    <span className="text-slate-300">Lat: {selectedClient.lat} | Lng: {selectedClient.lng}</span>
                    <a 
                      href={`https://www.google.com/maps?q=${selectedClient.lat},${selectedClient.lng}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline"
                    >
                      Abrir Mapa ↗
                    </a>
                  </div>
                </div>

                {/* Docs / Photos Placeholder */}
                <div>
                  <span className="text-slate-500 block uppercase text-[9px] font-mono mb-2">Expediente Digital</span>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-slate-900 text-center p-3 rounded-xl border border-slate-800 text-[10px] space-y-1">
                      <FileText className="w-4 h-4 mx-auto text-indigo-400" />
                      <span className="block font-semibold">INE / Comprobante</span>
                      <span className="text-slate-500 block text-[8px]">2 Documentos</span>
                    </div>
                    <div className="flex-1 bg-slate-900 text-center p-3 rounded-xl border border-slate-800 text-[10px] space-y-1">
                      <Image className="w-4 h-4 mx-auto text-emerald-400" />
                      <span className="block font-semibold">Instalación</span>
                      <span className="text-slate-500 block text-[8px]">Fotografías</span>
                    </div>
                  </div>
                </div>

                {/* Lead context & Conversion action */}
                {canCreateClient && selectedClient.status === 'lead' && (
                  <div className="bg-gradient-to-tr from-indigo-900/20 to-sky-900/20 p-4 rounded-2xl border border-indigo-500/20 space-y-3">
                    <div className="flex items-center space-x-1.5 text-indigo-300 font-bold font-mono">
                      <TrendingUp className="w-4 h-4" />
                      <span>Embudo Comercial: Lead Calificado</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal italic">
                      "{selectedClient.notes || 'Cliente prospecto interesado esperando viabilidad de instalación.'}"
                    </p>
                    <button
                      id="convert-lead-btn"
                      onClick={() => handleConvertLead(selectedClient)}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-600 hover:opacity-90 text-white font-mono font-bold text-xs flex items-center justify-center space-x-2 transition shadow-lg"
                    >
                      <span>Aprobar Conversión a Cliente</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Suspension / Reactivation core triggers */}
                {canManageClientLifecycle && selectedClient.status !== 'lead' && (
                  <div className="border-t border-slate-900 pt-4 space-y-2">
                    <span className="text-slate-500 block uppercase text-[9px] font-mono mb-1">Comandos RouterOS MikroTik</span>
                    <div className="flex gap-2">
                      {selectedClient.status === 'active' ? (
                        <button
                          id="suspend-client-api-trigger"
                          onClick={() => onUpdateClientStatus(selectedClient.id, 'suspended')}
                          className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 border border-rose-500 text-white rounded-xl font-semibold transition text-[11px] flex items-center justify-center space-x-1"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          <span>Suspender PPPoE</span>
                        </button>
                      ) : (
                        <button
                          id="reactivate-client-api-trigger"
                          onClick={() => onUpdateClientStatus(selectedClient.id, 'active')}
                          className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white rounded-xl font-semibold transition text-[11px] flex items-center justify-center space-x-1"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Reactivar Router Core</span>
                        </button>
                      )}
                      <button
                        onClick={() => onUpdateClientStatus(selectedClient.id, 'baja')}
                        className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl transition text-[11px]"
                      >
                        Baja
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center py-12 text-slate-500 font-mono">
              <Users className="w-12 h-12 text-slate-800 mx-auto mb-3" />
              <p className="text-sm">Selecciona una línea en el listado para inspeccionar su perfil comercial y técnico en MikroTik.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Client Diagonal Modal Backdrop */}
      {canCreateClient && showAddForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Briefcase className="w-4 h-4 text-indigo-400" />
                <span>Registrar Entrada: {isLeadForm ? 'Prospecto' : 'Cliente WISP Residencial/Corp'}</span>
              </h3>
              <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setIsLeadForm(false)}
                className={`flex-1 py-1 px-3 text-xs font-mono rounded ${!isLeadForm ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400'}`}
              >
                Cliente Activo
              </button>
              <button
                type="button"
                onClick={() => setIsLeadForm(true)}
                className={`flex-1 py-1 px-3 text-xs font-mono rounded ${isLeadForm ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400'}`}
              >
                Lead Comercial
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Nombre Completo o Razón Social</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Sofia Rodriguez Mendoza"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Tipo de Entidad</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="residential">Residencial</option>
                    <option value="corporate">Empresarial</option>
                    <option value="government">Gobierno</option>
                    <option value="hotel">Hoteles</option>
                    <option value="school">Escuelas</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Plan de Internet</label>
                  <select
                    value={formPlanId}
                    onChange={(e) => setFormPlanId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="">Selecciona velocidad...</option>
                    {plans.map(p => (
                      <option key={p.id} value={p.id}>{p.name} - ${p.price}/mes</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-indigo-400 font-mono font-semibold">Tecnología de Suscriptor</label>
                <select
                  value={formConnectionType}
                  onChange={(e) => setFormConnectionType(e.target.value as 'WISP' | 'FTTH')}
                  className="w-full bg-slate-900 border border-indigo-900/50 rounded-xl p-2.5 focus:outline-none focus:border-indigo-500 font-semibold"
                >
                  <option value="WISP">WISP - Antena Inalámbrica CPE (Ubiquiti/Cambium)</option>
                  <option value="FTTH">FTTH - Fibra Óptica (Puerto Gpon / Caja NAP)</option>
                </select>
              </div>

              <section
                id="customer-network-assignment"
                className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
                aria-label="Asignación de Red"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 font-semibold text-white">
                      <Network className="h-4 w-4 text-indigo-400" />
                      <span>Asignación de Red</span>
                    </h4>
                    <p className="mt-1 text-[10px] text-slate-500">
                      IPAM local/mock. No consulta ni modifica RouterOS.
                    </p>
                  </div>
                  <span className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[9px] text-slate-400">
                    {isLeadForm ? 'Opcional para Lead' : 'Obligatorio'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="customer-router-id" className="font-mono text-slate-400">
                      Router / Torre
                    </label>
                    <select
                      id="customer-router-id"
                      value={formRouterId}
                      required={!isLeadForm}
                      disabled={ipamLoading && ipamRouters.length === 0}
                      onChange={(event) => void handleRouterSelection(event.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    >
                      <option value="">Selecciona router o torre...</option>
                      {ipamRouters.map((router) => (
                        <option key={router.id} value={router.id}>
                          {router.name} · {router.kind === 'tower' ? 'Torre' : 'Router'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="customer-pool-id" className="font-mono text-slate-400">
                      Pool / Segmento
                    </label>
                    <select
                      id="customer-pool-id"
                      value={formPoolId}
                      required={!isLeadForm}
                      disabled={!formRouterId || ipamLoading || ipamPools.length === 0}
                      onChange={(event) => {
                        setFormPoolId(event.target.value);
                        setFormAssignedIp('');
                        setAvailableIps([]);
                        setIpValidation(null);
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    >
                      <option value="">Selecciona segmento...</option>
                      {ipamPools.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.name} · {pool.cidr}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {routerCapacity && (
                  <div
                    id="customer-router-capacity"
                    className={`rounded-xl border p-3 ${capacityToneClasses(routerCapacity.utilizationPercent)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="block text-[10px] font-mono uppercase opacity-80">
                          Capacidad de {routerCapacity.routerName}
                        </span>
                        <strong className="text-lg">{routerCapacity.utilizationPercent}% utilizada</strong>
                      </div>
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                      <span>Activos: <strong>{routerCapacity.activeClients}</strong></span>
                      <span>Libres: <strong>{routerCapacity.freeCapacity}</strong></span>
                      <span>Total: <strong>{routerCapacity.totalCapacity}</strong></span>
                    </div>
                    <p className="mt-2 text-[10px] opacity-75">
                      Indicador informativo; no bloquea el alta.
                    </p>
                  </div>
                )}

                {selectedPool && (
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 font-mono text-[10px] text-slate-400">
                    <span>Segmento: <strong className="text-slate-200">{selectedPool.cidr}</strong></span>
                    <span>Gateway: <strong className="text-slate-200">{selectedPool.gateway}</strong></span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    id="scan-available-ips-btn"
                    onClick={() => void handleScanAvailableIps()}
                    disabled={!formRouterId || !formPoolId || ipamLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-600/10 px-3 py-2 font-semibold text-indigo-300 transition hover:bg-indigo-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ipamLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                    <span>Escanear IPs disponibles</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIpEntryMode('select');
                      setFormAssignedIp('');
                      setIpValidation(null);
                    }}
                    className={`rounded-xl border px-3 py-2 font-mono text-[10px] transition ${
                      ipEntryMode === 'select'
                        ? 'border-indigo-500/40 bg-indigo-600/15 text-indigo-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Seleccionar IP libre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIpEntryMode('manual');
                      setFormAssignedIp('');
                      setIpValidation(null);
                    }}
                    className={`rounded-xl border px-3 py-2 font-mono text-[10px] transition ${
                      ipEntryMode === 'manual'
                        ? 'border-indigo-500/40 bg-indigo-600/15 text-indigo-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Escribir IP manualmente
                  </button>
                </div>

                <div className="space-y-1">
                  <label htmlFor="customer-assigned-ip" className="font-mono text-slate-400">
                    IP asignada
                  </label>
                  {ipEntryMode === 'select' ? (
                    <select
                      id="customer-assigned-ip"
                      value={formAssignedIp}
                      required={!isLeadForm}
                      disabled={!formPoolId || availableIps.length === 0}
                      onChange={(event) => {
                        const ip = event.target.value;
                        setFormAssignedIp(ip);
                        setIpValidation(null);
                        if (ip) void validateAssignedIp(ip);
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5 font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    >
                      <option value="">
                        {availableIps.length > 0
                          ? `Selecciona una de ${availableIps.length} IPs libres...`
                          : 'Escanea el segmento para cargar IPs libres...'}
                      </option>
                      {availableIps.map((ip) => <option key={ip} value={ip}>{ip}</option>)}
                    </select>
                  ) : (
                    <input
                      id="customer-assigned-ip"
                      type="text"
                      inputMode="numeric"
                      required={!isLeadForm}
                      placeholder="192.168.100.25"
                      value={formAssignedIp}
                      onChange={(event) => {
                        setFormAssignedIp(event.target.value);
                        setIpValidation(null);
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  )}
                </div>

                <div
                  id="customer-ip-status"
                  className={`flex items-start gap-2 rounded-xl border p-2.5 text-[11px] ${
                    ipValidation?.status === 'available'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : ipValidation
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                        : 'border-slate-800 bg-slate-950/70 text-slate-500'
                  }`}
                >
                  {ipValidation?.status === 'available'
                    ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div>
                    <span className="block font-mono font-bold uppercase">
                      Estado de IP: {ipStatusLabel(ipValidation?.status || null)}
                    </span>
                    <span>
                      {ipStatusMessage(ipValidation) || (
                        formRouterId
                          ? 'Escanea o escribe una IP para validar disponibilidad.'
                          : 'Selecciona router antes de asignar IP.'
                      )}
                    </span>
                  </div>
                </div>

                {ipamError && (
                  <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-300">
                    {ipamError}
                  </p>
                )}
              </section>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Email</label>
                  <input
                    type="email"
                    placeholder="sofia@email.com"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">WhatsApp / Celular</label>
                  <input
                    type="tel"
                    placeholder="55XXXXXXXX"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-slate-400 font-mono">Ubicación / Dirección</label>
                  <input
                    type="text"
                    placeholder="Av. Reforma 101"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Municipio/Ciudad</label>
                  <input
                    type="text"
                    placeholder="CDMX"
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5"
                  />
                </div>
              </div>

              <section
                id="customer-gps-coverage"
                className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
                aria-label="GPS y cobertura"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 font-semibold text-white">
                      <Crosshair className="h-4 w-4 text-indigo-400" />
                      GPS y cobertura
                    </h4>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Coordenadas editables y estimación informativa de cobertura.
                    </p>
                  </div>
                  <button
                    type="button"
                    id="get-current-location-btn"
                    onClick={handleGetCurrentLocation}
                    disabled={gpsLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-600/10 px-3 py-2 font-semibold text-indigo-300 transition hover:bg-indigo-600/20 disabled:opacity-50"
                  >
                    {gpsLoading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <MapPin className="h-3.5 w-3.5" />}
                    <span>Obtener ubicación actual</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="customer-latitude" className="text-slate-400 font-mono">
                      Coordenada Latitud GPS
                    </label>
                    <input
                      id="customer-latitude"
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      required
                      value={formLat}
                      onChange={(e) => {
                        setFormLat(e.target.value);
                        setGpsMessage('');
                        setCoverage(null);
                      }}
                      className={`w-full bg-slate-900 border rounded-xl p-2.5 font-mono ${
                        isValidLatitudeInput(formLat) ? 'border-slate-800' : 'border-rose-500/60'
                      }`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="customer-longitude" className="text-slate-400 font-mono">
                      Coordenada Longitud GPS
                    </label>
                    <input
                      id="customer-longitude"
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      required
                      value={formLng}
                      onChange={(e) => {
                        setFormLng(e.target.value);
                        setGpsMessage('');
                        setCoverage(null);
                      }}
                      className={`w-full bg-slate-900 border rounded-xl p-2.5 font-mono ${
                        isValidLongitudeInput(formLng) ? 'border-slate-800' : 'border-rose-500/60'
                      }`}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    id="check-customer-coverage-btn"
                    onClick={() => void checkCoverage()}
                    disabled={!formRouterId || !coordinatesValid || coverageLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-semibold text-slate-300 hover:border-indigo-500/40 hover:text-indigo-300 disabled:opacity-50"
                  >
                    {coverageLoading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <ScanLine className="h-3.5 w-3.5" />}
                    Calcular cobertura
                  </button>
                  {gpsMessage && <span className="text-emerald-400">{gpsMessage}</span>}
                  {gpsError && <span className="text-rose-400">{gpsError}</span>}
                </div>

                {coverage && (
                  <div
                    id="customer-coverage-result"
                    className={`grid grid-cols-2 gap-2 rounded-xl border p-3 font-mono text-[10px] sm:grid-cols-4 ${
                      coverage.status === 'GOOD'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : coverage.status === 'WARNING'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    <span>Distancia: <strong>{coverage.distanceKm} km</strong></span>
                    <span>Azimut: <strong>{coverage.azimuth}°</strong></span>
                    <span>Cobertura: <strong>{coverage.estimatedCoverage}%</strong></span>
                    <span>Estado: <strong>{coverage.status}</strong></span>
                  </div>
                )}
                {coverageError && <p className="text-rose-400">{coverageError}</p>}
                <p className="text-[10px] text-slate-500">
                  La estimación no bloquea el alta y no consulta equipos reales.
                </p>
              </section>

              <section
                id="customer-equipment-reservation"
                className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
                aria-label="Reserva de equipo"
              >
                <div>
                  <h4 className="flex items-center gap-2 font-semibold text-white">
                    <PackageCheck className="h-4 w-4 text-indigo-400" />
                    Reserva de equipo para instalación
                  </h4>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Reserva interna/mock. No descuenta ni modifica stock.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label htmlFor="customer-equipment-id" className="font-mono text-slate-400">
                      Equipo
                    </label>
                    <select
                      id="customer-equipment-id"
                      value={formEquipmentId}
                      disabled={equipmentLoading}
                      onChange={(event) => {
                        setFormEquipmentId(event.target.value);
                        setFormEquipmentSerial('');
                        setEquipmentReservation(null);
                        setEquipmentError('');
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5"
                    >
                      <option value="">Selecciona CPE, PoE o fuente...</option>
                      {customerEquipment.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.kind} · {item.name} · {item.availableQty} disponibles
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="customer-equipment-serial" className="font-mono text-slate-400">
                      Serie
                    </label>
                    <select
                      id="customer-equipment-serial"
                      value={formEquipmentSerial}
                      disabled={!selectedEquipment}
                      onChange={(event) => {
                        setFormEquipmentSerial(event.target.value);
                        setEquipmentReservation(null);
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5 font-mono disabled:opacity-50"
                    >
                      <option value="">Selecciona serie...</option>
                      {selectedEquipment?.serials.map((serial) => (
                        <option key={serial} value={serial}>{serial}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="customer-equipment-mac" className="font-mono text-slate-400">
                      MAC
                    </label>
                    <input
                      id="customer-equipment-mac"
                      type="text"
                      placeholder="AA:BB:CC:DD:EE:FF"
                      value={formEquipmentMac}
                      onChange={(event) => {
                        setFormEquipmentMac(event.target.value.toUpperCase());
                        setEquipmentReservation(null);
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2.5 font-mono uppercase"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  id="reserve-customer-equipment-btn"
                  onClick={() => void handleReserveEquipment()}
                  disabled={equipmentLoading || !formEquipmentId || !formEquipmentSerial || !formEquipmentMac}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-600/10 px-3 py-2 font-semibold text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50"
                >
                  {equipmentLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <PackageCheck className="h-3.5 w-3.5" />}
                  Reservar equipo
                </button>

                {equipmentReservation && (
                  <p
                    id="customer-equipment-reserved-status"
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-300"
                  >
                    Equipo reservado para instalación. Serie {equipmentReservation.serial}.
                  </p>
                )}
                {equipmentError && (
                  <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-300">
                    {equipmentError}
                  </p>
                )}
              </section>

              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Notas de Instalación / Comentarios</label>
                <textarea
                  placeholder="Detalles sobre por qué poste de luz bajar la acometida, o consideraciones en el rack corporativo..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 h-16 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  id="confirm-add-client-form-submit"
                  disabled={!canConfirmAdd || ipamLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl transition font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Confirmar Alta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
