import React, { useState } from 'react';
import { getErrorMessage } from '../lib/errors';
import {
  Shield, Plus, RefreshCw, Loader2, Server, Ban, Copy, Check, X,
} from 'lucide-react';
import type {
  WireguardServerView,
  WireguardPeerView,
  WireguardServerCreated,
  WireguardPeerCreated,
} from '../types';

interface Props {
  servers: WireguardServerView[];
  peers: WireguardPeerView[];
  onRefresh: () => Promise<void>;
  onCreateServer: (payload: Record<string, unknown>) => Promise<WireguardServerCreated>;
  onCreatePeer: (payload: Record<string, unknown>) => Promise<WireguardPeerCreated>;
  onRotatePeer: (id: string) => Promise<WireguardPeerCreated>;
  onRevokePeer: (id: string) => Promise<void>;
}

type SecretModal =
  | { kind: 'server'; data: WireguardServerCreated }
  | { kind: 'peer'; data: WireguardPeerCreated }
  | null;

const STATUS = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  revoked: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  disabled: 'bg-slate-700/30 text-slate-300 border-slate-600/30',
};

export default function WireguardManagerModule({ servers, peers, onRefresh, onCreateServer, onCreatePeer, onRotatePeer, onRevokePeer }: Props) {
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);
  const [secret, setSecret] = useState<SecretModal>(null);
  const [copied, setCopied] = useState('');

  const [showServer, setShowServer] = useState(false);
  const [sName, setSName] = useState('');
  const [sHost, setSHost] = useState('');
  const [sPort, setSPort] = useState('13231');

  const [showPeer, setShowPeer] = useState(false);
  const [pServer, setPServer] = useState('');
  const [pName, setPName] = useState('');
  const [pRouter, setPRouter] = useState('');

  const flash = (kind: 'success' | 'error', msg: string) => { setToast({ kind, msg }); setTimeout(() => setToast(null), 4000); };
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(''), 2000); } catch { /* noop */ }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { flash('error', getErrorMessage(e, 'Operación fallida.')); } finally { setBusy(''); }
  };

  const createServer = async (e: React.FormEvent) => {
    e.preventDefault();
    await run('Creando servidor...', async () => {
      const res = await onCreateServer({ name: sName, endpointHost: sHost, endpointPort: Number(sPort) || 13231 });
      setSecret({ kind: 'server', data: res });
      setSName(''); setSHost(''); setShowServer(false);
      await onRefresh();
    });
  };

  const createPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    await run('Creando peer...', async () => {
      const res = await onCreatePeer({ serverId: pServer, name: pName, routerId: pRouter || undefined });
      setSecret({ kind: 'peer', data: res });
      setPName(''); setPRouter(''); setShowPeer(false);
      await onRefresh();
    });
  };

  const rotate = (id: string) => {
    if (!window.confirm('Rotar las claves del peer genera credenciales nuevas e invalida las anteriores. ¿Continuar?')) return;
    run('Rotando peer...', async () => {
      const res = await onRotatePeer(id);
      setSecret({ kind: 'peer', data: res });
      await onRefresh();
    });
  };

  const revoke = (id: string) => {
    if (!window.confirm('Revocar el peer libera su IP y desactiva el túnel. ¿Continuar?')) return;
    run('Revocando peer...', async () => { await onRevokePeer(id); await onRefresh(); flash('success', 'Peer revocado.'); });
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {toast && (
        <div className={`fixed top-5 right-5 z-[60] px-4 py-3 rounded-xl border text-xs font-mono shadow-xl ${toast.kind === 'success' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>{toast.msg}</div>
      )}
      {busy && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex items-center space-x-2 bg-slate-950 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-mono shadow-xl">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /><span>{busy}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Shield className="w-6 h-6 text-indigo-400" />
            <span>WireGuard Manager</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Administración central de túneles WireGuard: servidores, peers, claves, direccionamiento y revocación.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onRefresh()} className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>
          <button onClick={() => setShowServer(true)} className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700"><Server className="w-3.5 h-3.5" /><span>Servidor</span></button>
          <button id="wg-add-peer" onClick={() => { setPServer(servers[0]?.id || ''); setShowPeer(true); }} disabled={servers.length === 0} className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-semibold"><Plus className="w-3.5 h-3.5" /><span>Peer</span></button>
        </div>
      </div>

      {/* Servers */}
      <div>
        <h3 className="text-sm font-bold text-white font-mono uppercase mb-2">Servidores ({servers.length})</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {servers.length === 0 ? (
            <p className="text-slate-500 text-[11px] italic font-mono">Sin servidores. Crea uno para empezar.</p>
          ) : servers.map((s) => (
            <div key={s.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-[11px] font-mono space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-sm">{s.name}</span>
                <span className={`px-2 py-0.5 rounded text-[9px] uppercase border ${STATUS[s.status]}`}>{s.status}</span>
              </div>
              <div className="text-slate-500">{s.endpointHost}:{s.endpointPort} · {s.vpnCidr} · {s.peersCount} peers</div>
              <div className="text-slate-600 truncate">pubkey: {s.publicKey}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Peers */}
      <div>
        <h3 className="text-sm font-bold text-white font-mono uppercase mb-2">Peers ({peers.length})</h3>
        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
          <table className="w-full text-left text-[11px] font-mono">
            <thead className="text-slate-500 uppercase text-[10px] border-b border-slate-900">
              <tr><th className="p-2.5">Nombre</th><th className="p-2.5">IP</th><th className="p-2.5">Router</th><th className="p-2.5">Estado</th><th className="p-2.5">Creado</th><th className="p-2.5 text-right">Acciones</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {peers.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center text-slate-500 italic">Sin peers.</td></tr>
              ) : peers.map((p) => (
                <tr key={p.id} id={`wg-peer-${p.id}`} className="hover:bg-slate-900/30">
                  <td className="p-2.5 text-slate-200">{p.name}</td>
                  <td className="p-2.5 text-indigo-300">{p.allocatedIp}</td>
                  <td className="p-2.5 text-slate-400">{p.routerId || '—'}</td>
                  <td className="p-2.5"><span className={`px-2 py-0.5 rounded text-[9px] uppercase border ${STATUS[p.status]}`}>{p.status}</span></td>
                  <td className="p-2.5 text-slate-500">{p.createdAt.substring(0, 10)}{p.lastRotatedAt ? ' · rotado' : ''}</td>
                  <td className="p-2.5 text-right space-x-1">
                    {p.status === 'active' && (
                      <>
                        <button onClick={() => rotate(p.id)} className="text-amber-400 hover:text-amber-300" title="Rotar claves"><RefreshCw className="w-3.5 h-3.5 inline" /></button>
                        <button onClick={() => revoke(p.id)} className="text-rose-400 hover:text-rose-300 ml-2" title="Revocar"><Ban className="w-3.5 h-3.5 inline" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create server modal */}
      {showServer && (
        <Modal title="Crear servidor WireGuard" onClose={() => setShowServer(false)}>
          <form onSubmit={createServer} className="space-y-3 text-xs">
            <Field label="Nombre"><input required value={sName} onChange={(e) => setSName(e.target.value)} placeholder="VPN NugaCore CDMX" className="inp" /></Field>
            <Field label="Endpoint host (público)"><input required value={sHost} onChange={(e) => setSHost(e.target.value)} placeholder="vpn.nugacore.local" className="inp font-mono" /></Field>
            <Field label="Endpoint port"><input value={sPort} onChange={(e) => setSPort(e.target.value)} className="inp font-mono" /></Field>
            <Actions onCancel={() => setShowServer(false)} busy={!!busy} submitLabel="Crear" />
          </form>
        </Modal>
      )}

      {/* Create peer modal */}
      {showPeer && (
        <Modal title="Crear peer WireGuard" onClose={() => setShowPeer(false)}>
          <form onSubmit={createPeer} className="space-y-3 text-xs">
            <Field label="Servidor">
              <select required value={pServer} onChange={(e) => setPServer(e.target.value)} className="inp">
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.vpnCidr})</option>)}
              </select>
            </Field>
            <Field label="Nombre"><input required value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Router Core Norte" className="inp" /></Field>
            <Field label="Router ID (opcional)"><input value={pRouter} onChange={(e) => setPRouter(e.target.value)} placeholder="mkt-1" className="inp font-mono" /></Field>
            <Actions onCancel={() => setShowPeer(false)} busy={!!busy} submitLabel="Crear" />
          </form>
        </Modal>
      )}

      {/* Secret modal (shown once) */}
      {secret && (
        <Modal title={secret.kind === 'server' ? 'Servidor creado — clave privada' : 'Peer creado — claves'} onClose={() => setSecret(null)}>
          <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-3 text-[11px] text-rose-200 mb-3">
            {secret.kind === 'server' ? secret.data.securityWarning : secret.data.securityWarning}
          </div>
          {secret.kind === 'server' ? (
            <SecretRow label="Server private key" value={secret.data.serverPrivateKey} copied={copied} onCopy={copy} />
          ) : (
            <div className="space-y-2">
              <SecretRow label="Peer private key" value={secret.data.privateKey} copied={copied} onCopy={copy} />
              <SecretRow label="Preshared key" value={secret.data.presharedKey} copied={copied} onCopy={copy} />
              <div className="text-[11px] font-mono text-slate-400 space-y-0.5 pt-1 border-t border-slate-900">
                <div>Server public key: <span className="text-slate-200 break-all">{secret.data.serverPublicKey}</span></div>
                <div>Endpoint: {secret.data.serverEndpoint} · IP asignada: {secret.data.assignedIp}</div>
                <div>Allowed CIDR: {secret.data.allowedCidr}</div>
              </div>
            </div>
          )}
          <div className="flex justify-end mt-3">
            <button onClick={() => setSecret(null)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-semibold">Ya lo guardé</button>
          </div>
        </Modal>
      )}

      <style>{`.inp{width:100%;background:#0f172a;color:#fff;border:1px solid #1e293b;border-radius:0.75rem;padding:0.6rem}`}</style>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-900 pb-3">
          <h3 className="text-base font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1"><label className="text-slate-400 font-mono">{label}</label>{children}</div>
);
const Actions = ({ onCancel, busy, submitLabel }: { onCancel: () => void; busy: boolean; submitLabel: string }) => (
  <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
    <button type="button" onClick={onCancel} className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl">Cancelar</button>
    <button type="submit" disabled={busy} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white px-5 py-2 rounded-xl font-semibold">{submitLabel}</button>
  </div>
);
function SecretRow({ label, value, copied, onCopy }: { label: string; value: string; copied: string; onCopy: (l: string, v: string) => void }) {
  return (
    <div className="bg-black border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[9px] text-slate-500 uppercase font-mono">{label}</div>
        <div className="text-[11px] text-emerald-400 font-mono break-all">{value}</div>
      </div>
      <button onClick={() => onCopy(label, value)} className="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1">
        {copied === label ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}<span>{copied === label ? 'Copiado' : 'Copiar'}</span>
      </button>
    </div>
  );
}
