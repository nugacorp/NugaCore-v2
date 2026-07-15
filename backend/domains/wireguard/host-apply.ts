// ====================================================================
// WireGuard host-apply: sincroniza peers activos de NugaCore → wg0 del VPS.
//
// La app NO ejecuta `wg` (sin NET_ADMIN). Empuja el estado deseado a un
// agente en el host (WIREGUARD_HOST_APPLY_URL) tras create/rotate/revoke
// y en un reconcile periódico para evitar claves viejas / drift.
// ====================================================================

import { logger } from '../../common/logger';

export interface DesiredWgPeer {
  publicKey: string;
  allocatedIp: string;
  name?: string;
}

export interface HostApplyResult {
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  peersApplied?: number;
}

export function isHostApplyEnabled(): boolean {
  const explicit = (process.env.WIREGUARD_HOST_APPLY_ENABLED || '').trim().toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'no' || explicit === 'off') {
    return false;
  }
  return getHostApplyUrl().length > 0;
}

export function getHostApplyUrl(): string {
  return (process.env.WIREGUARD_HOST_APPLY_URL || '').trim();
}

/** Timeout corto: no debe bloquear el enrollment más de unos segundos. */
export function getHostApplyTimeoutMs(): number {
  const n = Number(process.env.WIREGUARD_HOST_APPLY_TIMEOUT_MS || 5000);
  return Number.isFinite(n) && n > 500 ? Math.min(n, 30_000) : 5000;
}

export function getHostApplyReconcileIntervalMs(): number {
  const n = Number(process.env.WIREGUARD_HOST_APPLY_INTERVAL_MS || 60_000);
  return Number.isFinite(n) && n >= 10_000 ? Math.min(n, 600_000) : 60_000;
}

/**
 * Empuja el conjunto completo de peers activos al agente del host.
 * El agente reescribe wg0.conf y aplica con `wg syncconf` (sin teardown).
 */
export async function applyPeersToHost(peers: DesiredWgPeer[]): Promise<HostApplyResult> {
  if (!isHostApplyEnabled()) {
    return { ok: true, skipped: true, detail: 'host_apply_disabled' };
  }

  const url = getHostApplyUrl();
  const token = (process.env.WIREGUARD_HOST_APPLY_TOKEN || '').trim();
  const timeoutMs = getHostApplyTimeoutMs();

  const payload = {
    peers: peers.map((p) => ({
      publicKey: p.publicKey,
      allocatedIp: p.allocatedIp.replace(/\/\d+$/, ''),
      name: p.name || '',
    })),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let body: { ok?: boolean; peers?: number; error?: string } = {};
    try {
      body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
      body = {};
    }

    if (!res.ok) {
      const detail = body.error || text.slice(0, 200) || `http_${res.status}`;
      logger.error('wireguard_host_apply_failed', {
        status: res.status,
        detail,
        peers: peers.length,
      });
      return { ok: false, detail, peersApplied: peers.length };
    }

    logger.info('wireguard_host_apply_ok', {
      peers: body.peers ?? peers.length,
    });
    return {
      ok: true,
      peersApplied: body.peers ?? peers.length,
      detail: 'applied',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('wireguard_host_apply_error', { detail, peers: peers.length });
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

type PeerLoader = () => Promise<DesiredWgPeer[]>;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let peerLoader: PeerLoader | null = null;

/** Registra cómo cargar peers activos (desde WireguardService). */
export function configureHostApplyPeerLoader(loader: PeerLoader): void {
  peerLoader = loader;
}

export async function syncActivePeersToHost(): Promise<HostApplyResult> {
  if (!peerLoader) {
    return { ok: false, detail: 'peer_loader_not_configured' };
  }
  if (!isHostApplyEnabled()) {
    return { ok: true, skipped: true, detail: 'host_apply_disabled' };
  }
  try {
    const peers = await peerLoader();
    return applyPeersToHost(peers);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('wireguard_host_apply_load_failed', { detail });
    return { ok: false, detail };
  }
}

/**
 * Programa un sync pronto (debounce). Útil tras ráfagas de create/rotate/revoke.
 * No espera el resultado; combinar con syncActivePeersToHost() cuando hay que
 * garantizar apply antes de entregar el script.
 */
export function scheduleHostPeerSync(): void {
  if (!isHostApplyEnabled() || !peerLoader) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void syncActivePeersToHost();
  }, 250);
}

/** Sync inmediato + await (create/rotate/revoke en el camino del alta). */
export async function flushHostPeerSync(): Promise<HostApplyResult> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  return syncActivePeersToHost();
}

/**
 * Reconcile periódico: corrige drift (claves viejas, peers huérfanos en el host).
 */
export function startWireguardHostApplyReconcile(): () => void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  if (!isHostApplyEnabled()) {
    logger.info('wireguard_host_apply_reconcile_off');
    return () => {};
  }

  const intervalMs = getHostApplyReconcileIntervalMs();
  logger.info('wireguard_host_apply_reconcile_on', { intervalMs });

  // Primer sync al arrancar (después de un pequeño delay para estabilizar).
  const boot = setTimeout(() => {
    void syncActivePeersToHost();
  }, 3_000);

  reconcileTimer = setInterval(() => {
    void syncActivePeersToHost();
  }, intervalMs);

  return () => {
    clearTimeout(boot);
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
  };
}

/** Solo tests. */
export function resetHostApplyStateForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  peerLoader = null;
}
