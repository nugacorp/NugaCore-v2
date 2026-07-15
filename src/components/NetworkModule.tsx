import React, { useState } from 'react';
import { 
  Radio, 
  Plus, 
  CheckCircle, 
  Power,
  Copy,
  Server,
  Map as MapIcon,
  Cable,
} from 'lucide-react';
import { Tower, OltFTTH, OnuFTTH, Client, NapBox } from '../types';
import WispSitesMap from './gis/WispSitesMap';

interface NetworkModuleProps {
  towers: Tower[];
  olts: OltFTTH[];
  onus: OnuFTTH[];
  clients: Client[];
  naps: NapBox[];
  onToggleTower: (id: string) => Promise<void>;
  onProvisionOnu: (onuData: any) => Promise<void>;
  onCreateTower: (towerData: any) => Promise<void>;
}

export default function NetworkModule({ 
  towers, 
  olts, 
  onus, 
  clients, 
  naps = [],
  onToggleTower, 
  onProvisionOnu,
  onCreateTower
}: NetworkModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<'towers' | 'ftth'>('towers');
  const [showCoverage, setShowCoverage] = useState(true);
  const [showBackhaul, setShowBackhaul] = useState(true);
  const [showCpes, setShowCpes] = useState(true);
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null);

  // Tower Form modal state
  const [showTowerModal, setShowTowerModal] = useState(false);
  const [formTowerName, setFormTowerName] = useState('');
  const [formTowerIp, setFormTowerIp] = useState('10.150.10.1');
  const [formTowerLat, setFormTowerLat] = useState('19.4326');
  const [formTowerLng, setFormTowerLng] = useState('-99.1332');
  const [formTowerSsid, setFormTowerSsid] = useState('NugaCore_Antenna_A1');
  const [formTowerFreq, setFormTowerFreq] = useState('5800 Mhz');

  // Script copy state
  const [scriptCopied, setScriptCopied] = useState(false);

  // Selected NAP dynamically synced from props
  const [selectedNapId, setSelectedNapId] = useState<string | null>(null);
  const selectedNap = naps.find(n => n.id === selectedNapId) || (naps.length > 0 ? naps[0] : null);

  const [verificationAddress, setVerificationAddress] = useState('Col. Centro Benito Juarez');
  const [verificationResult, setVerificationResult] = useState<string | null>(null);

  // ONU Form Wizard State
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [formClientId, setFormClientId] = useState('');
  const [formOltId] = useState('');
  const [formPort, setFormPort] = useState('1');
  const [formMac, setFormMac] = useState('');
  const [formBrand, setFormBrand] = useState('Huawei');
  const [formModel] = useState('EG8145V5');
  const [formNapId, setFormNapId] = useState('');
  const [formNapPort, setFormNapPort] = useState('');

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId) return alert("Por favor selecciona un cliente para proveer la ONU FTTH.");
    
    await onProvisionOnu({
      clientId: formClientId,
      oltId: formOltId || olts[0]?.id || 'olt-1',
      port: Number(formPort),
      mac: formMac || 'HWTC' + Math.floor(Math.random() * 90000 + 10000).toString(16).toUpperCase(),
      brand: formBrand,
      model: formModel,
      napId: formNapId || undefined,
      napPort: formNapPort ? Number(formNapPort) : undefined
    });

    setShowProvisionModal(false);
    setFormClientId('');
    setFormMac('');
    setFormNapId('');
    setFormNapPort('');
  };

  const handleCreateTowerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTowerName) return;
    await onCreateTower({
      name: formTowerName,
      ip: formTowerIp,
      lat: Number(formTowerLat),
      lng: Number(formTowerLng),
      ssid: formTowerSsid,
      frequency: formTowerFreq
    });
    setFormTowerName('');
    setShowTowerModal(false);
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
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Radio className="w-6 h-6 text-sky-400" />
            Torres y Sitios WISP
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Mapa de sitios estilo UISP · backhaul, cobertura y CPEs. La planta de fibra está en{' '}
            <span className="text-emerald-300">Mapa FTTH</span>.
          </p>
        </div>
        <div className="flex bg-slate-950 p-1 border border-slate-800 rounded-xl space-x-1 self-start">
          <button
            type="button"
            onClick={() => setActiveSubTab('towers')}
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition ${
              activeSubTab === 'towers' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sitios WISP
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('ftth')}
            id="gpon-ftth-subtab"
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition ${
              activeSubTab === 'ftth' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ops FTTH (listas)
          </button>
        </div>
      </div>

      {activeSubTab === 'towers' ? (
        <div className="space-y-6">
          {/* Action Row for WISP Towers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Form Trigger Box */}
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-xl">
              <div className="flex items-center space-x-2">
                <Radio className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Registrar Nueva Estación / Torre</h3>
              </div>
              <p className="text-xs text-slate-400 leading-normal">
                Expanda la cobertura inalambrica agregando nuevas estaciones base (AP Ubiquiti Rocket/IsoStation) para irradiar señal a CPEs de nuevos suscriptores.
              </p>
              <button
                onClick={() => {
                  setFormTowerName('Torre Poniente');
                  setShowTowerModal(true);
                }}
                className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition shadow-lg shadow-indigo-600/15 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Agregar Nueva Torre WISP</span>
              </button>
            </div>

            {/* RouterOS Connect Script Box */}
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-3 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Server className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">Script de Vinculación MikroTik</h3>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`/system identity set name="MikroTik_NugaCore_Node"
/system script add name="NugaCore_Heartbeat" owner="admin" policy=read,write,test,api source={
  :local sysCpu [/system resource get cpu-load]
  :local sysRam (100 - (( [/system resource get free-memory] * 100) / [/system resource get total-memory]))
  /tool fetch url="http://3.14.72.10:3000/api/mikrotik/heartbeat" keep-result=no http-method=post http-data="cpu=$sysCpu&ram=$sysRam"
}
/system scheduler add name="NugaCore_Scheduler" interval=1m on-event="NugaCore_Heartbeat"`);
                      setScriptCopied(true);
                      setTimeout(() => setScriptCopied(false), 2000);
                    }}
                    className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    {scriptCopied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{scriptCopied ? '¡Copiado!' : 'Copiar Script'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-normal mt-1">
                  Ejecuta este comando en la Terminal de tu MikroTik RouterOS para sincronizar automáticamente el uso de CPU/RAM en tiempo real en NugaCore.
                </p>
              </div>
              
              <div className="bg-slate-900 border border-slate-850 p-3 rounded-xl font-mono text-[9px] text-emerald-300 overflow-x-auto whitespace-pre max-h-[85px]">
{`/system identity set name="MikroTik_NugaCore_Node"
/system script add name="NugaCore_Heartbeat" owner="admin" source={
  :local cpu [/system resource get cpu-load]
  :local ram (100 - (([/system resource get free-memory] * 100) / [/system resource get total-memory]))
  /tool fetch url="http://3.14.72.10:3000/api/mikrotik/heartbeat" http-method=post http-data="cpu=$cpu&ram=$ram"
}
/system scheduler add name="NugaCore_Scheduler" interval=1m on-event="NugaCore_Heartbeat"`}
              </div>
            </div>
          </div>

          {/* Mapa de sitios WISP (estilo UISP) */}
          <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] text-sky-400 font-mono tracking-wider font-bold uppercase flex items-center gap-1.5">
                  <MapIcon className="w-3.5 h-3.5" />
                  Mapa de sitios
                </span>
                <p className="text-[11px] text-slate-500 mt-1">
                  Pan/zoom · cobertura RF · enlaces backhaul y CPE. Clic en un sitio para ver detalle.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-300">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0" />
                  Cobertura
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showBackhaul} onChange={(e) => setShowBackhaul(e.target.checked)} className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0" />
                  Backhaul
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showCpes} onChange={(e) => setShowCpes(e.target.checked)} className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0" />
                  CPEs
                </label>
              </div>
            </div>
            {towers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
                Sin torres georreferenciadas. Agrega un sitio WISP para verlo en el mapa.
              </div>
            ) : (
              <WispSitesMap
                towers={towers}
                clients={clients}
                showCoverage={showCoverage}
                showBackhaul={showBackhaul}
                showCpes={showCpes}
                selectedTowerId={selectedTowerId}
                onSelectTower={setSelectedTowerId}
              />
            )}
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
          <div className="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 flex items-start gap-3 text-sm">
            <Cable className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-emerald-100 font-semibold text-sm">Mapa de fibra</p>
              <p className="text-[12px] text-emerald-100/70 mt-0.5 leading-relaxed">
                El mapa geográfico ODN (OLT → NAP → drop) está en <strong className="text-emerald-200">Red → Mapa FTTH</strong>.
                Aquí quedan las listas operativas: OLT, ONU y aprovisionamiento.
              </p>
            </div>
          </div>
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

          {/* Cajas NAP Control Board - Specific to fiber distribution requested by user */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Box: list of NAPs */}
            <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-3xl p-6 space-y-4">
              <div>
                <span className="text-[10px] text-indigo-400 font-mono tracking-wider font-bold block uppercase">Control de Distribución Planta Externa</span>
                <h3 className="text-base font-bold text-white mt-1">Cajas NAP Activas (Network Access Points)</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Auditoría física de hilos libres, espacios disponibles y mapeo de distribución de puertos.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {naps.map((nap) => (
                  <div
                    key={nap.id}
                    onClick={() => {
                      setSelectedNapId(nap.id);
                      setVerificationResult(null);
                    }}
                    className={`p-4 rounded-xl border text-xs cursor-pointer transition space-y-3 ${
                      selectedNap?.id === nap.id 
                        ? 'bg-slate-900 border-indigo-500/50' 
                        : 'bg-slate-900/40 border-slate-900 hover:border-slate-800'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-white text-sm font-mono">{nap.id}</span>
                        <div className="flex items-center space-x-1.5 mt-0.5">
                          <span className="text-slate-500 text-[10px] font-mono">Splitter {nap.splitRatio}</span>
                          <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 text-[8px] px-1 py-0.2 rounded font-mono font-bold uppercase">
                            {nap.ponPort}
                          </span>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase ${
                        nap.fibersFree > 1 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse'
                      }`}>
                        {nap.fibersFree} hilos
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-normal">{nap.name}</p>

                    <div className="text-[9px] text-slate-500 font-mono mt-1">
                      GPS: {nap.lat}, {nap.lng}
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>Ocupación de hilos</span>
                        <span>{nap.fibersTotal - nap.fibersFree}/{nap.fibersTotal}</span>
                      </div>
                      <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-1.5 rounded-full" 
                          style={{ width: `${((nap.fibersTotal - nap.fibersFree) / nap.fibersTotal) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Box: Selected NAP Details Map & Diagnostic Coverage Feasibility Checker */}
            <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-3xl p-6 space-y-5">
              {selectedNap ? (
                <div className="space-y-5">
                  <div className="border-b border-slate-900 pb-3">
                    <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded font-bold">
                      Uplink Alimentador OLT: {selectedNap.ponPort}
                    </span>
                    <h4 className="text-sm font-bold text-white mt-1.5">{selectedNap.name}</h4>
                    <span className="text-[10px] font-mono text-slate-550">GPS: {selectedNap.lat}, {selectedNap.lng} | Rango: {selectedNap.coverageMeters}m</span>
                  </div>

                  {/* Ports Grid representing the real physical ports in the NAP box */}
                  <div className="space-y-2">
                    <span className="text-[10px] text-indigo-400 font-mono tracking-wider font-bold block uppercase">Conectores Acopladores de Fibra</span>
                    <div className="grid grid-cols-4 gap-2">
                      {selectedNap.ports.map((port: any) => (
                        <div
                          key={port.num}
                          className={`p-2 rounded-xl border text-center font-mono transition relative group ${
                            port.status === 'occupied'
                              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          }`}
                        >
                          <div className="text-[11px] font-bold">P-{port.num}</div>
                          <div className="text-[8px] uppercase tracking-tighter opacity-70 mt-0.5">
                            {port.status === 'occupied' ? 'Ocupado' : 'Libre'}
                          </div>

                          {/* Hover Tooltip showing user client name details */}
                          {port.status === 'occupied' && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-slate-950 border border-slate-800 text-white text-[9px] rounded-lg px-2.5 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition z-10 pointer-events-none shadow-lg">
                              {port.client}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Feasibility Map Tool */}
                  <div className="bg-slate-905 p-4 rounded-2xl border border-slate-900 space-y-3">
                    <span className="text-indigo-400 font-bold uppercase text-[9px] font-mono block">Simular Cobertura para Solicitud de Factibilidad</span>
                    <p className="text-[10px] text-slate-450 leading-normal">
                      Verifique disponibilidad de hilos antes de mandar la cuadrilla a instalar la fibra.
                    </p>
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Escribe dirección a confirmar..."
                        value={verificationAddress}
                        onChange={(e) => setVerificationAddress(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200"
                      />
                      <button
                        onClick={() => {
                          if (selectedNap.fibersFree > 0) {
                            setVerificationResult(`¡VERIFICADO - COBERTURA CON EXITO! El solicitante de la zona [${verificationAddress}] se sitúa a 95 metros de la caja de empalme ${selectedNap.id}. Existen ${selectedNap.fibersFree} acopladores disponibles para splitter óptico.`);
                          } else {
                            setVerificationResult(`ADVERTENCIA: La caja ${selectedNap.id} se encuentra al 100% de ocupación. Se requiere splitter secundario o tendido adicional.`);
                          }
                        }}
                        className="w-full py-2 bg-indigo-650 hover:bg-indigo-650 bg-indigo-600 border border-indigo-500/50 hover:border-indigo-400 text-white text-xs font-mono font-bold rounded-xl transition cursor-pointer"
                      >
                        Validar Factibilidad GPON
                      </button>
                    </div>

                    {verificationResult && (
                      <div className={`p-3 rounded-xl border text-[10.5px] leading-relaxed transition ${
                        verificationResult.includes('CON EXITO') 
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-450 text-rose-400'
                      }`}>
                        {verificationResult}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-slate-500 font-mono text-xs space-y-2">
                  <div className="text-3xl">🔌</div>
                  <p className="text-slate-400 font-bold">Sin Caja Selecta</p>
                  <p className="text-[10px] text-slate-600 max-w-xs mx-auto">
                    Selecciona cualquier Caja NAP de la izquierda para desplegar diagramas de hilos, nombres de suscriptores y factibilidades de cobertura.
                  </p>
                </div>
              )}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Asociar Caja NAP</label>
                  <select
                    value={formNapId}
                    onChange={(e) => {
                      setFormNapId(e.target.value);
                      setFormNapPort('');
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="">-- Sin Caja NAP --</option>
                    {naps.map(nap => (
                      <option key={nap.id} value={nap.id}>
                        {nap.id} ({nap.ponPort})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400">Puerto / Hilo NAP</label>
                  <select
                    value={formNapPort}
                    disabled={!formNapId}
                    onChange={(e) => setFormNapPort(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">-- Seleccionar --</option>
                    {formNapId && naps.find(n => n.id === formNapId)?.ports.map(port => (
                      <option 
                        key={port.num} 
                        value={port.num}
                        disabled={port.status === 'occupied'}
                      >
                        H-{port.num} {port.status === 'occupied' ? '❌ (Ocupado)' : '🟢 (Disp)'}
                      </option>
                    ))}
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
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold font-mono"
                >
                  Registrar & Configurar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Base Station Tower Modal */}
      {showTowerModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5">
                <span>Registrar Nueva Torre Base</span>
              </h3>
              <button onClick={() => setShowTowerModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <form onSubmit={handleCreateTowerSubmit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Identificador / Nombre de la Estación</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Torre Chapultepec"
                  value={formTowerName}
                  onChange={(e) => setFormTowerName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Dirección IPv4</label>
                  <input
                    type="text"
                    required
                    value={formTowerIp}
                    onChange={(e) => setFormTowerIp(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">SSID de Enlace</label>
                  <input
                    type="text"
                    required
                    value={formTowerSsid}
                    onChange={(e) => setFormTowerSsid(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Latitud GPS</label>
                  <input
                    type="text"
                    required
                    value={formTowerLat}
                    onChange={(e) => setFormTowerLat(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Longitud GPS</label>
                  <input
                    type="text"
                    required
                    value={formTowerLng}
                    onChange={(e) => setFormTowerLng(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Frecuencia de Operación (Mhz)</label>
                <input
                  type="text"
                  required
                  value={formTowerFreq}
                  onChange={(e) => setFormTowerFreq(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-white"
                />
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowTowerModal(false)}
                  className="border border-slate-880 border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold"
                >
                  Confirmar Torre
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
