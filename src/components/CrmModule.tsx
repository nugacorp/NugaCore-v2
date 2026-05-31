import React, { useState } from 'react';
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
  ArrowRight
} from 'lucide-react';
import { Client, Plan } from '../types';

interface CrmModuleProps {
  clients: Client[];
  plans: Plan[];
  onAddClient: (newClientData: any) => Promise<void>;
  onUpdateClientStatus: (id: string, status: 'active' | 'suspended' | 'baja') => Promise<void>;
}

export default function CrmModule({ clients, plans, onAddClient, onUpdateClientStatus }: CrmModuleProps) {
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
  const [isLeadForm, setIsLeadForm] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

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
    if (!formName) return;

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
                          <div className="text-[10px] text-slate-500 mt-0.5">{client.ip !== '0.0.0.0' ? client.ip : 'Sin IP'}</div>
                        </td>
                        <td className="py-3 px-2 text-slate-400">{client.city}</td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            {client.status === 'suspended' && (
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
                {selectedClient.status === 'lead' && (
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
                {selectedClient.status !== 'lead' && (
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
      {showAddForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Coordenada Latitud GPS</label>
                  <input
                    type="text"
                    value={formLat}
                    onChange={(e) => setFormLat(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Coordenada Longitud GPS</label>
                  <input
                    type="text"
                    value={formLng}
                    onChange={(e) => setFormLng(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
              </div>

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
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl transition font-semibold"
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
