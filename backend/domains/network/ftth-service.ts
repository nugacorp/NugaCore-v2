import {
  FiberSegment,
  FiberThread,
  FtthImportPreview,
  FtthImportResult,
  NapBox,
  NapPort,
  OnuFTTH,
  OltFTTH,
} from '../../../src/types';
import { isDomainOnDb } from '../../config/feature-flags';
import { store } from '../../state/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import { previewFtthImport } from './ftth-import-parser';

const WRITE_ROLES_HINT = 'super admin, administrador, tecnico';

export class FtthService {
  private useDb = isDomainOnDb('ftth') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  constructor() {
    if (this.useDb) logger.info('FTTH: persistencia = Supabase (USE_DB_FTTH=true)');
  }

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase not configured');
    return supabaseAdmin;
  }

  async listOlts(): Promise<OltFTTH[]> {
    if (this.useDb) {
      const { data, error } = await this.admin.from('olts').select('*').order('name');
      if (error) throw error;
      return (data ?? []).map(this.rowToOlt);
    }
    return store.OLTS;
  }

  async listOnus(): Promise<OnuFTTH[]> {
    if (this.useDb) {
      const { data, error } = await this.admin.from('onus').select('*');
      if (error) throw error;
      return (data ?? []).map(this.rowToOnu);
    }
    return store.ONUS;
  }

  async listNaps(): Promise<NapBox[]> {
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('nap_boxes')
        .select('*, nap_ports(*)')
        .order('name');
      if (error) throw error;
      return (data ?? []).map((row) => this.rowToNap(row));
    }
    return store.NAP_BOXES;
  }

  async getNap(id: string): Promise<NapBox | null> {
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('nap_boxes')
        .select('*, nap_ports(*)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? this.rowToNap(data) : null;
    }
    return store.NAP_BOXES.find((n) => n.id === id) ?? null;
  }

  async listFiberSegments(): Promise<FiberSegment[]> {
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('fiber_segments')
        .select('*, fiber_threads(*)')
        .order('created_at', { ascending: false });
      if (error) {
        if (this.isMissingTable(error)) return store.FIBER_SEGMENTS;
        throw error;
      }
      return (data ?? []).map((row) => this.rowToSegment(row));
    }
    return store.FIBER_SEGMENTS;
  }

  async createFiberSegment(input: Omit<FiberSegment, 'threads'>): Promise<FiberSegment> {
    const segment: FiberSegment = {
      ...input,
      threads: this.buildThreadsForSegment(input.id, input.threadCount),
    };

    if (this.useDb) {
      const { error: segErr } = await this.admin.from('fiber_segments').upsert(this.segmentToRow(segment), {
        onConflict: 'id',
      });
      if (segErr) {
        if (this.isMissingTable(segErr)) {
          return this.upsertSegmentMemory(segment);
        }
        throw segErr;
      }
      const { error: threadErr } = await this.admin
        .from('fiber_threads')
        .upsert(
          (segment.threads ?? []).map((t) => this.threadToRow(t)),
          { onConflict: 'id' },
        );
      if (threadErr && !this.isMissingTable(threadErr)) throw threadErr;
      return segment;
    }

    return this.upsertSegmentMemory(segment);
  }

  async deleteFiberSegment(id: string): Promise<void> {
    if (this.useDb) {
      const { error } = await this.admin.from('fiber_segments').delete().eq('id', id);
      if (error && !this.isMissingTable(error)) throw error;
      return;
    }
    store.FIBER_SEGMENTS = store.FIBER_SEGMENTS.filter((s) => s.id !== id);
  }

  previewImport(payload: {
    format: 'csv-naps' | 'csv-segments' | 'geojson' | 'mixed';
    napsCsv?: string;
    segmentsCsv?: string;
    geojson?: string;
  }): FtthImportPreview {
    return previewFtthImport(payload);
  }

  async importBatch(payload: {
    format: 'csv-naps' | 'csv-segments' | 'geojson' | 'mixed';
    napsCsv?: string;
    segmentsCsv?: string;
    geojson?: string;
    dryRun?: boolean;
  }): Promise<FtthImportResult> {
    const preview = this.previewImport(payload);
    if (payload.dryRun || preview.errors.length > 0) {
      return {
        napsCreated: 0,
        napsUpdated: 0,
        segmentsCreated: 0,
        segmentsUpdated: 0,
        errors: preview.errors,
      };
    }

    let napsCreated = 0;
    let napsUpdated = 0;
    let segmentsCreated = 0;
    let segmentsUpdated = 0;

    for (const nap of preview.naps) {
      const existing = await this.getNap(nap.id);
      await this.upsertNap(nap);
      if (existing) napsUpdated += 1;
      else napsCreated += 1;
    }

    for (const segment of preview.segments) {
      const existing = (await this.listFiberSegments()).find((s) => s.id === segment.id);
      await this.createFiberSegment(segment);
      if (existing) segmentsUpdated += 1;
      else segmentsCreated += 1;
    }

    return { napsCreated, napsUpdated, segmentsCreated, segmentsUpdated, errors: [] };
  }

  async upsertNap(nap: NapBox): Promise<NapBox> {
    const normalized = this.normalizeNapCounts(nap);
    if (this.useDb) {
      const { error: boxErr } = await this.admin.from('nap_boxes').upsert(
        {
          id: normalized.id,
          name: normalized.name,
          pon_port: normalized.ponPort,
          fibers_free: normalized.fibersFree,
          fibers_total: normalized.fibersTotal,
          lat: normalized.lat,
          lng: normalized.lng,
          split_ratio: normalized.splitRatio,
          coverage_meters: normalized.coverageMeters,
        },
        { onConflict: 'id' },
      );
      if (boxErr) throw boxErr;

      const portRows = normalized.ports.map((p) => ({
        nap_id: normalized.id,
        num: p.num,
        status: p.status,
        client: p.client,
        thread_id: p.threadId ?? null,
        continues_to_nap_id: p.continuesToNapId ?? null,
        continues_to_thread: p.continuesToThread ?? null,
      }));
      const { error: portsErr } = await this.admin
        .from('nap_ports')
        .upsert(portRows, { onConflict: 'nap_id,num' });
      if (portsErr) throw portsErr;
      return normalized;
    }

    const idx = store.NAP_BOXES.findIndex((n) => n.id === normalized.id);
    if (idx === -1) store.NAP_BOXES.push(normalized);
    else store.NAP_BOXES[idx] = normalized;
    return normalized;
  }

  async updateNapPort(
    napId: string,
    portNum: number,
    patch: Partial<Pick<NapPort, 'status' | 'client' | 'continuesToNapId' | 'continuesToThread'>>,
  ): Promise<NapBox | null> {
    const nap = await this.getNap(napId);
    if (!nap) return null;

    const port = nap.ports.find((p) => p.num === portNum);
    if (!port) return null;

    if (patch.status !== undefined) port.status = patch.status;
    if (patch.client !== undefined) port.client = patch.client;
    if (patch.continuesToNapId !== undefined) port.continuesToNapId = patch.continuesToNapId;
    if (patch.continuesToThread !== undefined) port.continuesToThread = patch.continuesToThread;

    const updated = this.normalizeNapCounts({ ...nap, ports: [...nap.ports] });
    await this.upsertNap(updated);
    return updated;
  }

  private upsertSegmentMemory(segment: FiberSegment): FiberSegment {
    const idx = store.FIBER_SEGMENTS.findIndex((s) => s.id === segment.id);
    if (idx === -1) store.FIBER_SEGMENTS.unshift(segment);
    else store.FIBER_SEGMENTS[idx] = segment;
    return segment;
  }

  private buildThreadsForSegment(segmentId: string, threadCount: number): FiberThread[] {
    return Array.from({ length: threadCount }, (_, i) => ({
      id: `${segmentId}-t${i + 1}`,
      segmentId,
      threadNum: i + 1,
      status: 'free' as const,
      clientLabel: '',
    }));
  }

  private normalizeNapCounts(nap: NapBox): NapBox {
    const ports =
      nap.ports.length > 0
        ? nap.ports
        : Array.from({ length: nap.fibersTotal }, (_, i) => ({
            num: i + 1,
            status: 'free' as const,
            client: '',
          }));
    const fibersTotal = Math.max(nap.fibersTotal, ports.length);
    const fibersFree = ports.filter((p) => p.status === 'free').length;
    return { ...nap, ports, fibersTotal, fibersFree };
  }

  private isMissingTable(error: { code?: string; message?: string }): boolean {
    const code = String(error.code || '');
    const msg = String(error.message || '').toLowerCase();
    return code === '42P01' || code === 'PGRST205' || msg.includes('does not exist');
  }

  private rowToOlt(row: Record<string, unknown>): OltFTTH {
    return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as OltFTTH['status'],
      brand: String(row.brand ?? 'GPON') as OltFTTH['brand'],
      ip: String(row.ip),
      portsCount: Number(row.ports_count ?? 16),
      onusConnected: Number(row.onus_connected ?? 0),
      onusLimit: Number(row.onus_limit ?? 1024),
      splitters: Array.isArray(row.splitters) ? (row.splitters as OltFTTH['splitters']) : [],
    };
  }

  private rowToOnu(row: Record<string, unknown>): OnuFTTH {
    return {
      id: String(row.id),
      clientId: String(row.client_id ?? ''),
      clientName: String(row.client_name ?? ''),
      oltId: String(row.olt_id ?? 'olt-1'),
      port: Number(row.port ?? 1),
      mac: String(row.mac ?? ''),
      signalDb: Number(row.signal_db ?? -25),
      status: row.status as OnuFTTH['status'],
      brand: String(row.brand ?? ''),
      model: String(row.model ?? ''),
      napId: row.nap_id ? String(row.nap_id) : undefined,
      napPort: row.nap_port != null ? Number(row.nap_port) : undefined,
    };
  }

  private rowToNap(row: Record<string, unknown>): NapBox {
    const rawPorts = Array.isArray(row.nap_ports)
      ? row.nap_ports
      : Array.isArray(row.ports)
        ? row.ports
        : [];
    const ports: NapPort[] = rawPorts
      .map((p) => {
        const port = p as Record<string, unknown>;
        return {
          num: Number(port.num),
          status: (port.status === 'occupied' ? 'occupied' : 'free') as NapPort['status'],
          client: String(port.client ?? ''),
          threadId: port.thread_id ? String(port.thread_id) : undefined,
          continuesToNapId: port.continues_to_nap_id ? String(port.continues_to_nap_id) : undefined,
          continuesToThread:
            port.continues_to_thread != null ? Number(port.continues_to_thread) : undefined,
        };
      })
      .sort((a, b) => a.num - b.num);

    const fibersTotal = Number(row.fibers_total ?? ports.length ?? 8);
    const nap: NapBox = {
      id: String(row.id),
      name: String(row.name),
      ponPort: String(row.pon_port ?? '1/1'),
      lat: Number(row.lat ?? 0),
      lng: Number(row.lng ?? 0),
      fibersTotal,
      fibersFree: Number(row.fibers_free ?? fibersTotal),
      splitRatio: String(row.split_ratio ?? '1:8'),
      coverageMeters: Number(row.coverage_meters ?? 200),
      ports,
    };
    return this.normalizeNapCounts(nap);
  }

  private rowToSegment(row: Record<string, unknown>): FiberSegment {
    const rawThreads = Array.isArray(row.fiber_threads) ? row.fiber_threads : [];
    const threads: FiberThread[] = rawThreads.map((t) => {
      const thread = t as Record<string, unknown>;
      return {
        id: String(thread.id),
        segmentId: String(thread.segment_id ?? row.id),
        threadNum: Number(thread.thread_num ?? 1),
        napId: thread.nap_id ? String(thread.nap_id) : undefined,
        portNum: thread.port_num != null ? Number(thread.port_num) : undefined,
        status: (thread.status as FiberThread['status']) || 'free',
        continuesToNapId: thread.continues_to_nap_id ? String(thread.continues_to_nap_id) : undefined,
        continuesToThread:
          thread.continues_to_thread != null ? Number(thread.continues_to_thread) : undefined,
        clientLabel: String(thread.client_label ?? ''),
      };
    });

    const coordinates = this.parseCoordinates(row.coordinates);
    return {
      id: String(row.id),
      name: String(row.name),
      fromRef: row.from_ref ? String(row.from_ref) : undefined,
      toRef: row.to_ref ? String(row.to_ref) : undefined,
      fromLabel: String(row.from_label ?? ''),
      toLabel: String(row.to_label ?? ''),
      segmentType: (row.segment_type as FiberSegment['segmentType']) || 'feeder',
      threadCount: Number(row.thread_count ?? threads.length ?? 12),
      coordinates,
      napId: row.nap_id ? String(row.nap_id) : undefined,
      ponPort: row.pon_port ? String(row.pon_port) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      threads,
    };
  }

  private parseCoordinates(value: unknown): Array<[number, number]> {
    if (!value) return [];
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((pair) => {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        const lat = Number(pair[0]);
        const lng = Number(pair[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng] as [number, number];
      })
      .filter((p): p is [number, number] => p !== null);
  }

  private segmentToRow(segment: FiberSegment) {
    return {
      id: segment.id,
      name: segment.name,
      from_ref: segment.fromRef ?? null,
      to_ref: segment.toRef ?? null,
      from_label: segment.fromLabel,
      to_label: segment.toLabel,
      segment_type: segment.segmentType,
      thread_count: segment.threadCount,
      coordinates: segment.coordinates,
      nap_id: segment.napId ?? null,
      pon_port: segment.ponPort ?? null,
      notes: segment.notes ?? null,
    };
  }

  private threadToRow(thread: FiberThread) {
    return {
      id: thread.id,
      segment_id: thread.segmentId,
      thread_num: thread.threadNum,
      nap_id: thread.napId ?? null,
      port_num: thread.portNum ?? null,
      status: thread.status,
      continues_to_nap_id: thread.continuesToNapId ?? null,
      continues_to_thread: thread.continuesToThread ?? null,
      client_label: thread.clientLabel,
    };
  }
}

let cached: FtthService | null = null;
export const getFtthService = () => {
  if (!cached) cached = new FtthService();
  return cached;
};

export { WRITE_ROLES_HINT };
