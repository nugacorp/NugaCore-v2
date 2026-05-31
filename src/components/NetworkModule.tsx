import React, { useState } from 'react';
import { 
  Network, 
  Settings, 
  Activity, 
  Radio, 
  Cpu, 
  Database, 
  Wrench, 
  Plus, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  HelpCircle,
  RefreshCw,
  Power
} from 'lucide-react';
import { Tower, OltFTTH, OnuFTTH, Client } from '../types';

interface NetworkModuleProps {
  towers: Tower[];
  olts: OltFTTH[];
  onus: OnuFTTH[];
  clients: Client[];
  onToggleTower: (id: string) => Promise<void>;
  onProvisionOnu: (onuData: any) => Promise<void>;
}

export default function NetworkModule({ towers, olts, onus, clients, onToggleTower, onProvisionOnu }: NetworkModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<'towers' | 'ftth'>('towers');

  // ONU Form Wizard State
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [formClientId, setFormClientId] = useState('');
  const [formOltId, setFormOltId] = useState('');
  const [formPort, setFormPort] = useState('1');
  const [formMac, setFormMac] = useState('');
  const [formBrand, setFormBrand] = useState('Huawei');
  const [formModel, setFormModel] = useState('EG8145V5');

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId) return alert("Por favor selecciona un cliente para proveer la ONU FTTH.");
    
    await onProvisionOnu({
      clientId: formClientId,
      oltId: formOltId || olts[0]?.id || 'olt-1',
      port: Number(formPort),
      mac: formMac || 'HWTC' + Math.floor(Math.random() * 90000 + 10000).toString(16).toUpperCase(),
      brand: formBrand,
      model: formModel
    });

    setShowProvisionModal(false);
    setFormClientId('');
    setFormMac('');
  };

  const getSignalBadgeColor = (db: number) => {
    if (db >= -22) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (db >= -26) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/20 animate-pulse';
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Header Bento layout */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Topología de Red, WISP & FTTH</h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Supervisión integral de radiofrecuencia (Ubiquiti/Cambium) y planta externa de fibra óptica (OLT Huawei - GPON).
          </p>
        </div>
        <div className="flex bg-slate-950 p-1 border border-slate-800 rounded-xl space-x-1 self-start">
          <button
            onClick={() => setActiveSubTab('towers')}
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition ${
              activeSubTab === 'towers' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Infraestructura Torres WISP
          </button>
          <button
            onClick={() => setActiveSubTab('ftth')}
            id="gpon-ftth-subtab"
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition ${
              activeSubTab === 'ftth' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Red GPON / FTTH Fibra
          </button>
        </div>
      </div>

      {activeSubTab === 'towers' ? (
        <div className="space-y-6">
          {/* Bento boxes for Towers info */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-12 bg-slate-950 p-6 rounded-3xl border border-slate-800">
              <span className="text-[10px] text-indigo-400 font-mono tracking-wider font-bold block uppercase mb-3">Topología de Enlaces Backhaul</span>
              <div className="flex items-center space-x-4 overflow-x-auto py-2">
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-850 text-center shrink-0 w-44">
                  <span className="text-xs font-bold text-white uppercase font-mono">Core Router CDMX</span>
                  <p className="text-[10px] text-slate-500 font-mono mt-1">CCR2116 core API</p>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[9px] border border-emerald-500/20 px-1.5 py-0.5 rounded mt-2 inline-block font-mono">10 Gbps SFP+ up</span>
                </div>
                <div className="text-slate-600 font-bold shrink-0">── (15km Fibra) ──</div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-850 text-center shrink-0 w-44">
                  <span className="text-xs font-bold text-white uppercase font-mono">Torre Ajusco</span>
                  <p className="text-[10px] text-slate-500 font-mono mt-1">Uplink Principal 5Ghz</p>
                  <span className="bg-amber-500/10 text-amber-400 text-[9px] border border-amber-500/20 px-1.5 py-0.5 rounded mt-2 inline-block font-mono">Ping: 24 ms</span>
                </div>
                <div className="text-slate-600 font-bold shrink-0">── (5.4km Radio) ──</div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-850 text-center shrink-0 w-44">
                  <span className="text-xs font-bold text-white uppercase font-mono">Torre del Valle</span>
                  <p className="text-[10px] text-slate-500 font-mono mt-1">Repetidor Local</p>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[9px] border border-emerald-500/20 px-1.5 py-0.5 rounded mt-2 inline-block font-mono">Ping: 8 ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* List of Towers */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {towers.map((tower) => (
              <div 
                key={tower.id}
                id={`network-tower-card-${tower.id}`}
                className="bg-slate-950 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between hover:border-slate-700 transition"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center space-x-2">
                        <Radio className="w-4 h-4 text-indigo-400" />
                        <span>{tower.name}</span>
                      </h3>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">IP Node: {tower.ip}</p>
                    </div>

                    <div>
                      {tower.status === 'online' && (
                        <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono px-2 py-0.5 rounded-full uppercase font-bold text-right">
                          Online
                        </span>
                      )}
                      {tower.status === 'warning' && (
                        <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[9px] font-mono px-2 py-0.5 rounded-full uppercase font-bold text-right animate-pulse">
                          Warning
                        </span>
                      )}
                      {tower.status === 'offline' && (
                        <span className="bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[9px] font-mono px-2 py-0.5 rounded-full uppercase font-bold text-right animate-pulse">
                          Offline
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Telemetry levels */}
                  <div className="grid grid-cols-2 gap-2 mt-4 text-[10px] font-mono bg-slate-900/60 p-3 rounded-xl border border-slate-900">
                    <div>
                      <span className="text-slate-500 uppercase block">Carga CPU</span>
                      <span className="font-semibold text-slate-300">{tower.cpu}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase block">Consumo RAM</span>
                      <span className="font-semibold text-slate-300">{tower.ram}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase block">Temperatura</span>
                      <span className="font-semibold text-slate-300">{tower.tempCelsius}°C</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase block">Ping ICMP</span>
                      <span className={`font-semibold ${tower.pingMs === -1 ? 'text-rose-400' : 'text-slate-300'}`}>
                        {tower.pingMs === -1 ? 'Falla' : `${tower.pingMs} ms`}
                      </span>
                    </div>
                  </div>

                  {/* Ports connected info */}
                  <div className="mt-4 space-y-1">
                    <span className="text-[9px] text-slate-500 uppercase font-mono block">Puertos de Switch</span>
                    {tower.ports.map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] font-mono py-0.5 border-b border-slate-900/40">
                        <span className="text-slate-400">{p.port}</span>
                        <span className={`font-semibold ${p.status === 'up' ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {p.status === 'up' ? p.speed : 'Unplugged'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Control Trigger */}
                <div className="mt-5 pt-3 border-t border-slate-900 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono">Uptime: {tower.uptime}</span>
                  <button
                    id={`toggle-tower-telemetry-btn-${tower.id}`}
                    onClick={() => onToggleTower(tower.id)}
                    className={`px-3 py-1 rounded text-[11px] font-mono border font-semibold flex items-center space-x-1 shadow ${
                      tower.status === 'offline'
                        ? 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <Power className="w-3 h-3" />
                    <span>{tower.status === 'offline' ? 'Iniciar Enlace' : 'Simular Caída'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div id="ftth-gpon-view" className="space-y-6">
          {/* OLT details block */}
          {olts.map((olt) => (
            <div key={olt.id} className="bg-slate-950 border border-slate-800 rounded-3xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-900 pb-4 mb-4 gap-3">
                <div>
                  <span className="text-[9px] bg-blue-500/15 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded uppercase font-bold font-mono">GPON OLT Chassis</span>
                  <h3 className="text-lg font-bold text-white mt-1.5">{olt.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">IP de Gestión: {olt.ip} | Marca: {olt.brand}</p>
                </div>
                
                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 font-mono block uppercase">Porcentaje de Ocupación</span>
                    <span className="text-sm font-bold text-white">{olt.onusConnected} de {olt.onusLimit} ONUs activas</span>
                  </div>
                  <button
                    onClick={() => setShowProvisionModal(true)}
                    id="open-provision-onu-wizard"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Aprovisionar ONU Fibra</span>
                  </button>
                </div>
              </div>

              {/* Splitters Grid */}
              <div className="space-y-2">
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Splitters Ópticos Primarios (Mesa de Distribución GPON)</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {olt.splitters.map((s) => (
                    <div key={s.id} className="bg-slate-900/60 p-3 rounded-xl border border-slate-900 space-y-2">
                      <div className="flex justify-between font-mono text-[10px]">
                        <span className="text-slate-300 font-bold">{s.id}</span>
                        <span className="text-slate-500 font-normal">Hijo GPON {s.ratio}</span>
                      </div>
                      <div className="flex items-baseline space-x-1.5">
                        <span className="text-lg font-bold font-mono">{s.occupied}</span>
                        <span className="text-[9px] text-slate-500">fibras ocupadas</span>
                      </div>
                      <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                        <div 
                          className="bg-blue-400 h-1 rounded-full" 
                          style={{ width: `${(s.occupied / Number(s.ratio.split(':')[1])) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {/* Provisioned ONUs list */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5">
            <span className="text-sm font-bold text-white tracking-wide block mb-3 font-mono">ONUs GPON Aprovisionadas en Planta Externa</span>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 text-slate-500 font-mono uppercase">
                    <th className="py-2.5 px-2">Suscriptor</th>
                    <th className="py-2.5 px-2 font-mono">Puerto GPON / MAC address</th>
                    <th className="py-2.5 px-2 font-mono">Especificaciones</th>
                    <th className="py-2.5 px-2 font-mono">Nivel de Señal Óptica</th>
                    <th className="py-2.5 px-2">Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {onus.map((onu) => (
                    <tr key={onu.id} className="hover:bg-slate-900/40 transition">
                      <td className="py-2.5 px-2 font-bold text-white">{onu.clientName}</td>
                      <td className="py-2.5 px-2 font-mono">
                        Port {onu.port}
                        <span className="text-slate-500 text-[10px] block font-light">{onu.mac}</span>
                      </td>
                      <td className="py-2.5 px-2 text-slate-400">{onu.brand} {onu.model}</td>
                      <td className="py-2.5 px-2 font-mono">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getSignalBadgeColor(onu.signalDb)}`}>
                          {onu.signalDb} dBm
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        {onu.status === 'online' ? (
                          <span className="text-emerald-400 font-bold font-mono">ONLINE</span>
                        ) : (
                          <span className="text-rose-400 font-bold font-mono animate-pulse">OFFLINE</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Provision ONU Modal */}
      {showProvisionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5">
                <span>Aprovisionar ONU FTTH</span>
              </h3>
              <button onClick={() => setShowProvisionModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <form onSubmit={handleProvisionSubmit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Seleccionar Cliente Suscriptor</label>
                <select
                  required
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                >
                  <option value="">-- Buscar suscriptor residencial/comercial --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">OLT Port</label>
                  <input
                    type="number"
                    min="1"
                    max="16"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Fabricante ONU</label>
                  <select
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="Huawei">Huawei (EG8145V5)</option>
                    <option value="ZTE">ZTE</option>
                    <option value="FiberHome">FiberHome</option>
                    <option value="Ubiquiti">Ubiquiti UFiber ONU</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">ONU MAC / Número de Serie Pon</label>
                <input
                  type="text"
                  placeholder="Ej: HWTCFE90A175"
                  value={formMac}
                  onChange={(e) => setFormMac(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                />
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowProvisionModal(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  id="confirm-onu-provision-btn"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold"
                >
                  Registrar & Configurar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
