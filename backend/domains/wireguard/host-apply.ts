// ====================================================================
// WireGuard host-apply: sincroniza peers activos de NugaCore → wg0 del VPS.
//
// La app NO ejecuta `wg` (sin NET_ADMIN). Empuja el estado deseado a un
// agente en el host (WIREGUARD_HOST_APPLY_URL) tras create/rotate/revoke
// y en un reconcile periódico para evitar claves viejas / drift.
// ====================================================================

import { logger } from '../../common/logger';
import { decryptSecret } from '../../services/crypto';
import { isWireguardMultitenantEnabled } from '../../config/feature-flags';

export interface DesiredWgPeer {
  publicKey: string;
  allocatedIp: string;
  name?: string;
  /**
   * PSK CIFRADA (contrato v2). Se descifra SÓLO en el borde del POST al agente
   * (applyPeersToHost), nunca se materializa en claro fuera de esa frontera.
   */
  encryptedPresharedKey?: string;
  /** Subred /24 del tenant dueño del peer (contrato v2). */
  tenantSubnet?: string;
}

/**
 * Estado deseado completo del host wg0 (contrato v2). El reconcile y cada
 * mutación envían esto; `revision` es monotónica (una por mutación) y el agente
 * re-aplica idempotente cuando recibe la misma (==).
 */
export interface DesiredWgState {
  peers: DesiredWgPeer[];
  tenantSubnets: string[];
  revision: number;
}

export interface HostApplyResult {
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  peersApplied?: number;
  /** v2: revisión y digest acusados por el agente (para el ACK de estado). */
  revision?: number;
  digest?: string;
  schemaVersion?: number;
}

/** Capacidad del host reportada por GET /health (gate de altas multi-tenant). */
export interface HostCapacity {
  ok: boolean;
  schemaVersion?: number;
  firewall?: boolean;
  revision?: number;
  detail?: string;
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

/**
 * URL de GET /health del agente. Override explícito por WIREGUARD_HOST_HEALTH_URL;
 * si no, se deriva de la URL de /apply (mismo bind/puerto, path /health).
 */
export function getHostHealthUrl(): string {
  const explicit = (process.env.WIREGUARD_HOST_HEALTH_URL || '').trim();
  if (explicit) return explicit;
  const apply = getHostApplyUrl();
  if (!apply) return '';
  if (/\/apply\/?$/.test(apply)) return apply.replace(/\/apply\/?$/, '/health');
  return `${apply.replace(/\/$/, '')}/health`;
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

/** POST del cuerpo ya construido al agente. Parsea la respuesta v1/v2. */
async function postApply(body: Record<string, unknown>, peerCount: number): Promise<HostApplyResult> {
  const url = getHostApplyUrl();
  const token = (process.env.WIREGUARD_HOST_APPLY_TOKEN || '').trim();
  const timeoutMs = getHostApplyTimeoutMs();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let parsed: { ok?: boolean; peers?: number; error?: string; revision?: number; digest?: string; schemaVersion?: number } = {};
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch {
      parsed = {};
    }

    if (!res.ok) {
      const detail = parsed.error || text.slice(0, 200) || `http_${res.status}`;
      logger.error('wireguard_host_apply_failed', { status: res.status, detail, peers: peerCount });
      return { ok: false, detail, peersApplied: peerCount };
    }

    logger.info('wireguard_host_apply_ok', { peers: parsed.peers ?? peerCount, revision: parsed.revision });
    return {
      ok: true,
      peersApplied: parsed.peers ?? peerCount,
      revision: parsed.revision,
      digest: parsed.digest,
      schemaVersion: parsed.schemaVersion,
      detail: 'applied',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('wireguard_host_apply_error', { detail, peers: peerCount });
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

/** Cuerpo v1: peers sueltos (sin PSK, sin subredes). Comportamiento actual. */
function buildV1Body(peers: DesiredWgPeer[]): Record<string, unknown> {
  return {
    peers: peers.map((p) => ({
      publicKey: p.publicKey,
      allocatedIp: p.allocatedIp.replace(/\/\d+$/, ''),
      name: p.name || '',
    })),
  };
}

/**
 * Cuerpo v2: schemaVersion + revisión + tenantSubnets + peers con PSK y
 * tenantSubnet. La PSK se DESCIFRA aquí (borde del POST) y no antes.
 */
function buildV2Body(state: DesiredWgState): Record<string, unknown> {
  return {
    schemaVersion: 2,
    revision: state.revision,
    tenantSubnets: state.tenantSubnets,
    peers: state.peers.map((p) => {
      const peer: Record<string, unknown> = {
        publicKey: p.publicKey,
        allocatedIp: p.allocatedIp.replace(/\/\d+$/, ''),
        name: p.name || '',
      };
      if (p.tenantSubnet) peer.tenantSubnet = p.tenantSubnet;
      if (p.encryptedPresharedKey) {
        try {
          peer.presharedKey = decryptSecret(p.encryptedPresharedKey);
        } catch (err) {
          logger.warn('wireguard_host_apply_psk_decrypt_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return peer;
    }),
  };
}

/**
 * Empuja el conjunto completo de peers activos al agente del host (v1).
 * El agente reescribe wg0.conf y aplica con `wg syncconf` (sin teardown).
 */
export async function applyPeersToHost(peers: DesiredWgPeer[]): Promise<HostApplyResult> {
  if (!isHostApplyEnabled()) {
    return { ok: true, skipped: true, detail: 'host_apply_disabled' };
  }
  return postApply(buildV1Body(peers), peers.length);
}

/**
 * Empuja el estado deseado completo. Con WIREGUARD_MULTITENANT encendido envía
 * el contrato v2 (PSK, tenantSubnet, tenantSubnets, revisión); apagado, v1.
 */
export async function applyStateToHost(state: DesiredWgState): Promise<HostApplyResult> {
  if (!isHostApplyEnabled()) {
    return { ok: true, skipped: true, detail: 'host_apply_disabled' };
  }
  if (isWireguardMultitenantEnabled()) {
    return postApply(buildV2Body(state), state.peers.length);
  }
  return postApply(buildV1Body(state.peers), state.peers.length);
}

/**
 * Consulta GET /health del agente. Acredita capacidad multi-tenant sólo si
 * ok && schemaVersion>=2 && firewall activo. Cualquier error/timeout ⇒ no
 * acreditado (fail-closed).
 */
export async function checkHostCapacity(): Promise<HostCapacity> {
  const url = getHostHealthUrl();
  if (!isHostApplyEnabled() || !url) {
    return { ok: false, detail: 'host_apply_disabled' };
  }
  const timeoutMs = getHostApplyTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    const text = await res.text().catch(() => '');
    let body: { ok?: boolean; schemaVersion?: number; firewall?: boolean; revision?: number } = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    const schemaVersion = Number(body.schemaVersion ?? 0);
    const firewall = body.firewall === true;
    const accredited = res.ok && body.ok === true && schemaVersion >= 2 && firewall;
    return {
      ok: accredited,
      schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : undefined,
      firewall,
      revision: typeof body.revision === 'number' ? body.revision : undefined,
      detail: accredited ? 'accredited' : `http_${res.status}`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

type StateLoader = () => Promise<DesiredWgState>;
type OnAppliedCallback = (result: HostApplyResult) => Promise<void> | void;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let stateLoader: StateLoader | null = null;
let onApplied: OnAppliedCallback | null = null;

/**
 * Registra cómo cargar el estado deseado (peers + subredes + revisión) y un
 * callback opcional que corre tras un apply exitoso (para el ACK de estado).
 */
export function configureHostApplyStateLoader(loader: StateLoader, applied?: OnAppliedCallback): void {
  stateLoader = loader;
  onApplied = applied ?? null;
}

export async function syncActivePeersToHost(): Promise<HostApplyResult> {
  if (!stateLoader) {
    return { ok: false, detail: 'peer_loader_not_configured' };
  }
  if (!isHostApplyEnabled()) {
    return { ok: true, skipped: true, detail: 'host_apply_disabled' };
  }
  try {
    const state = await stateLoader();
    const result = await applyStateToHost(state);
    if (result.ok && !result.skipped && onApplied) {
      try {
        await onApplied(result);
      } catch (err) {
        logger.warn('wireguard_host_apply_on_applied_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
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
  if (!isHostApplyEnabled() || !stateLoader) return;
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
  stateLoader = null;
  onApplied = null;
}
