import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Send,
  Sparkles,
  Network,
  Plus,
} from 'lucide-react';
import RouterOnboardingWizard from './RouterOnboardingWizard';
import { canStartRouterOnboarding } from '../lib/routerOnboardingRbac';

export interface MikrotikRouter {
  id: string;
  name: string;
  model: string;
  ip: string;
  location: string;
  cpuCores: number;
  ramTotal: string;
  rosVersion: string;
  promptUser: string;
  status: 'online' | 'warning' | 'offline';
}

export const MIKROTIK_ROUTERS: MikrotikRouter[] = [
  {
    id: 'mkt-1',
    name: 'Router Principal (Norte)',
    model: 'RB5009UG+S+OUT',
    ip: '10.0.1.1',
    location: 'Torre del Valle (Norte)',
    cpuCores: 4,
    ramTotal: '1024 MB',
    rosVersion: '7.12',
    promptUser: 'admin@NugaCore_Norte',
    status: 'online'
  },
  {
    id: 'mkt-2',
    name: 'Router Core (Sur)',
    model: 'CCR2116-12G-4S+',
    ip: '10.0.1.3',
    location: 'Torre Ajusco (Sur-Master)',
    cpuCores: 16,
    ramTotal: '16 GB',
    rosVersion: '7.14.2 (stable)',
    promptUser: 'admin@SurMaster_CCR2116',
    status: 'warning'
  },
  {
    id: 'mkt-3',
    name: 'Concentrador San Pedro',
    model: 'hEX lite',
    ip: '10.0.1.5',
    location: 'Repetidor San Pedro',
    cpuCores: 1,
    ramTotal: '64 MB',
    rosVersion: '6.49',
    promptUser: 'admin@SanPedro_hEX_Client',
    status: 'online'
  }
];

import MikrotikRoutersPanel from './MikrotikRoutersPanel';
import MikrotikWorkerPanel from './MikrotikWorkerPanel';
import MikrotikConfigAuditPanel from './MikrotikConfigAuditPanel';
import type {
  MikrotikRouterView,
  ProvisioningScriptResponse,
  MikrotikTestConnectionResponse,
  MikrotikWorkerRun,
  RouterSnapshot,
} from '../types';
import type { UserRole } from '../lib/supabase';

interface MikrotikModuleProps {
  logs: any[];
  onSendCommand: (cmd: string, routerId?: string) => Promise<{ output: string }>;
  onAskCopilot: (prompt: string, routerContext?: any) => Promise<{ text: string }>;
  // Provisioning (Fase 4.4)
  provisionedRouters: MikrotikRouterView[];
  userRole: UserRole;
  onRefreshRouters: () => Promise<void>;
  onCreateRouter: (payload: Record<string, unknown>) => Promise<void>;
  onGenerateScript: (id: string, connectionType: string, server?: Record<string, unknown>) => Promise<ProvisioningScriptResponse>;
  onRotateCredentials: (id: string, connectionType: string, server?: Record<string, unknown>) => Promise<ProvisioningScriptResponse>;
  onTestConnection: (id: string) => Promise<MikrotikTestConnectionResponse>;
  // Worker (Fase 4.6)
  workerRuns: MikrotikWorkerRun[];
  onRunWorker: () => Promise<void>;
  onReadRouter: (id: string) => Promise<RouterSnapshot>;
  onRefreshWorkerRuns: () => Promise<void>;
  // Onboarding Wizard (Fase 4.9)
  getAuthHeaders?: () => Promise<Record<string, string>>;
}

export default function MikrotikModule({
  logs,
  onSendCommand,
  onAskCopilot,
  provisionedRouters,
  userRole,
  onRefreshRouters,
  onCreateRouter,
  onGenerateScript,
  onRotateCredentials,
  onTestConnection,
  workerRuns,
  onRunWorker,
  onReadRouter,
  onRefreshWorkerRuns,
  getAuthHeaders,
}: MikrotikModuleProps) {
  // Onboarding Wizard (Fase 4.9)
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Connected Router State
  const [activeRouter, setActiveRouter] = useState<MikrotikRouter>(MIKROTIK_ROUTERS[0]);

  // Command Shell States
  const [commandInput, setCommandInput] = useState('');
  const [shellLines, setShellLines] = useState<string[]>([
    "[admin@NugaCore_Norte] > /system resource print",
    "uptime: 45d 12h 30m",
    "version: 7.12 (stable)",
    "cpu: arm64",
    "cpu-count: 4",
    "cpu-load: 8%",
    "free-memory: 680MB",
    "total-memory: 1024MB",
    "[admin@NugaCore_Norte] > "
  ]);
  const [executingCommand, setExecutingCommand] = useState(false);

  // Copilot States
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotMessages, setCopilotMessages] = useState<any[]>([
    {
      sender: 'assistant',
      text: '¡Hola! Soy el Copiloto IA de NugaCore. Puedo ayudarte a redactar scripts para RouterOS v6 o v7, diseñar políticas de queues simples (Simple Queues) para QoS, aprovisionar PPP Secrets de tus clientes, deudores cautivos y diagnosticar pérdidas de potencia en tu OLT o conector SFP. ¿Qué script o diagnóstico necesitas hoy?'
    }
  ]);
  const [copilotLoading, setCopilotLoading] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const shellConsoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Handle Switching Routers Beautifully
  const handleRouterChange = (routerId: string) => {
    const selected = MIKROTIK_ROUTERS.find(r => r.id === routerId);
    if (!selected) return;
    const oldIp = activeRouter.ip;
    setActiveRouter(selected);
    
    setShellLines(prev => [
      ...prev,
      `\n`,
      `[SSH Session Closed from ${oldIp}]`,
      `Connecting to ${selected.name} (${selected.ip}) via standard port 22...`,
      `Establishing SSH Terminal session... SUCCESS.`,
      `Welcome to MikroTik RouterOS v${selected.rosVersion} on ${selected.model}`,
      `Type /system resource print to read router specs on live node.`,
      `[${selected.promptUser}] > `
    ]);

    // Provide helpful helper message to AI Chat
    setCopilotMessages(prev => [
      ...prev,
      {
        sender: 'assistant',
        text: `🔌 Se ha cambiado la sesión SSH activa. Ahora estás interactuando con el router '${selected.name}' (${selected.model}) con IP ${selected.ip} ubicado en ${selected.location}. El Copiloto IA ya está sincronizado con esta especificación.`
      }
    ]);
  };

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    const cmd = commandInput.trim();
    setExecutingCommand(true);
    setShellLines(prev => [...prev, `[${activeRouter.promptUser}] > ${cmd}`]);

    try {
      const res = await onSendCommand(cmd, activeRouter.id);
      setShellLines(prev => [...prev, res.output, `[${activeRouter.promptUser}] > `]);
    } catch {
      setShellLines(prev => [...prev, "Error communicating with Core Router engine.", `[${activeRouter.promptUser}] > `]);
    } finally {
      setExecutingCommand(false);
      setCommandInput('');
    }
  };

  const handleAskCopilotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotInput.trim()) return;

    const prompt = copilotInput.trim();
    setCopilotMessages(prev => [...prev, { sender: 'user', text: prompt }]);
    setCopilotLoading(true);
    setCopilotInput('');

    try {
      const res = await onAskCopilot(prompt, activeRouter);
      setCopilotMessages(prev => [...prev, { sender: 'assistant', text: res.text }]);
    } catch {
      setCopilotMessages(prev => [...prev, { 
        sender: 'assistant', 
        text: 'Ocurrió un error consultando a Gemini. Por favor verifica los logs o reintenta.' 
      }]);
    } finally {
      setCopilotLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Onboarding Wizard (Fase 4.9) */}
      {showOnboarding && getAuthHeaders && (
        <RouterOnboardingWizard
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
          onCompleted={() => { setShowOnboarding(false); onRefreshRouters(); }}
          userRole={userRole}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {/* Header Bento block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Terminal className="w-6 h-6 text-indigo-400" />
            <span>MikroTik RouterOS Central & Copiloto AI</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Consola interactiva SSH/API, monitoreo del demonio de logs syslog, y asistente de red Gemini v3.5 integrado.
          </p>
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Botón Agregar Router (Fase 4.9) */}
          {getAuthHeaders && canStartRouterOnboarding(userRole) && (
            <button
              onClick={() => setShowOnboarding(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 rounded-xl transition-colors"
            >
              <Plus size={14} /> Agregar Router
            </button>
          )}
          {/* Dropdown Selector */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center space-x-2 font-mono text-xs">
            <Network className="w-4 h-4 text-indigo-400 animate-pulse shrink-0" />
            <span className="text-slate-500 font-bold uppercase select-none shrink-0">Router:</span>
            <select
              value={activeRouter.id}
              onChange={(e) => handleRouterChange(e.target.value)}
              className="bg-transparent text-emerald-400 font-medium font-mono focus:outline-none focus:ring-0 cursor-pointer text-xs pr-6"
            >
              {MIKROTIK_ROUTERS.map(router => (
                <option key={router.id} value={router.id} className="bg-slate-950 text-slate-200">
                  {router.name} — {router.ip} ({router.model})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 justify-center">
            <span className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 ${
              activeRouter.status === 'online' ? 'bg-emerald-500 animate-ping' :
              activeRouter.status === 'warning' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
            }`}></span>
            <span className="text-slate-400">APIS: {activeRouter.status.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Routers MikroTik & Provisioning (Fase 4.4) */}
      <MikrotikRoutersPanel
        routers={provisionedRouters}
        userRole={userRole}
        onRefresh={onRefreshRouters}
        onCreateRouter={onCreateRouter}
        onGenerateScript={onGenerateScript}
        onRotateCredentials={onRotateCredentials}
        onTestConnection={onTestConnection}
      />

      {/* Worker MikroTik · Read Only + Dry Run (Fase 4.6) */}
      <MikrotikWorkerPanel
        routers={provisionedRouters}
        runs={workerRuns}
        userRole={userRole}
        onRunWorker={onRunWorker}
        onReadRouter={onReadRouter}
        onRefreshRuns={onRefreshWorkerRuns}
      />

      {getAuthHeaders && provisionedRouters[0]?.id && (
        <MikrotikConfigAuditPanel
          routerId={provisionedRouters[0].id}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {/* Main Grid: Copilot on Left, Terminal and logs on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Wisp Network AI Copilot (7 columns) */}
        <div className="lg:col-span-7 bg-gradient-to-tr from-indigo-950/20 to-slate-950 p-6 rounded-3xl border border-indigo-500/10 flex flex-col justify-between h-[600px]">
          <div>
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span>NugaCore Copiloto Gemini AI v3.5-flash</span>
              </h3>
              <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded font-mono font-bold uppercase uppercase tracking-wider">
                Copiloto WISP
              </span>
            </div>

            {/* AI Messages list */}
            <div className="space-y-4 h-[410px] overflow-y-auto pr-1 text-xs">
              {copilotMessages.map((msg, i) => (
                <div 
                  key={i} 
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`p-3.5 rounded-2xl max-w-[85%] leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-none'
                        : 'bg-slate-900/90 border border-slate-800 text-slate-300 rounded-tl-none whitespace-pre-wrap font-sans'
                    }`}
                  >
                    {msg.sender === 'assistant' && (
                      <span className="text-[9px] text-indigo-400 font-mono tracking-widest block mb-2 uppercase font-bold">
                        Asistente NugaCore
                      </span>
                    )}
                    <span className="font-sans text-[11px] font-normal">{msg.text}</span>
                  </div>
                </div>
              ))}
              {copilotLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-900/90 border border-slate-800 p-3 h-10 rounded-2xl rounded-tl-none flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Form input */}
          <form onSubmit={handleAskCopilotSubmit} className="mt-4 flex gap-2">
            <input
              type="text"
              required
              disabled={copilotLoading}
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              placeholder="Pregunta cómo configurar QoS Simple Queues, o un script para ruteo OSPF..."
              className="flex-1 bg-slate-900 border border-slate-800/80 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
            />
            <button
              id="copilot-ask-btn"
              type="submit"
              disabled={copilotLoading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Live Terminal & Logs console (5 columns) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Shell CLI */}
          <div className="bg-black border border-slate-800 rounded-3xl p-5 h-[340px] flex flex-col justify-between font-mono text-xs">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3 truncate flex items-center space-x-1.5">
                <span className="text-indigo-400">▶</span>
                <span>SSH: <strong className="text-slate-300 font-mono font-bold">{activeRouter.promptUser}@{activeRouter.ip}</strong> ({activeRouter.model})</span>
              </p>
              <div 
                ref={shellConsoleRef}
                className="space-y-1 h-[210px] overflow-y-auto font-mono text-[11px] text-emerald-400 leading-snug pr-1"
              >
                {shellLines.map((line, k) => (
                  <div key={k} className="whitespace-pre-wrap">{line}</div>
                ))}
              </div>
            </div>

            <form onSubmit={handleCommandSubmit} className="mt-3 flex border-t border-slate-900 pt-3">
              <input
                type="text"
                disabled={executingCommand}
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder="/ip address print"
                className="flex-1 bg-transparent border-none text-emerald-400 placeholder-emerald-900 text-[11px] font-mono focus:outline-none"
              />
              <button 
                id="execute-shell-btn"
                type="submit" 
                className="text-[10px] text-indigo-400 font-bold hover:text-indigo-300"
              >
                [ENTER]
              </button>
            </form>
          </div>

          {/* Core Logs feed */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 h-[235px] flex flex-col">
            <span className="text-[10px] text-slate-500 font-mono tracking-widest block uppercase mb-2">SYSLOGS CORE MIKROTIK</span>
            <div className="flex-1 overflow-y-auto text-[10px] font-mono text-slate-400 leading-normal space-y-1.5 pr-1">
              {logs.map((log, idx) => (
                <div key={idx} className="flex space-x-2 py-0.5 border-b border-slate-900/30">
                  <span className="text-slate-600 shrink-0">{log.timestamp.split(' ')[1] || log.timestamp}</span>
                  <span className="text-slate-300 truncate">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
