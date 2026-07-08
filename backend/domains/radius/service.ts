import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';

export interface RadiusSessionView {
  id: string;
  username: string;
  clientId?: string;
  nasIp?: string;
  sessionId?: string;
  bytesIn: number;
  bytesOut: number;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'closed';
}

const memorySessions: RadiusSessionView[] = [
  {
    id: 'rad-1',
    username: 'pppoe-c-1',
    clientId: 'c-1',
    nasIp: '10.0.0.1',
    sessionId: 'sess-demo-1',
    bytesIn: 1_024_000_000,
    bytesOut: 256_000_000,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: 'active',
  },
];

export class RadiusService {
  private useDb = isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  constructor() {
    logger.info('RADIUS: modo diseño (OLA 6) — sin FreeRADIUS live');
  }

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase not configured');
    return supabaseAdmin;
  }

  status() {
    return {
      enabled: false,
      mode: 'design',
      integration: 'stub',
      liveAccounting: false,
      note: 'FreeRADIUS/PPPoE accounting real pendiente — OLA 6 foundation.',
      sessionsSource: this.useDb ? 'db' : 'memory',
    };
  }

  async listSessions(limit = 50): Promise<RadiusSessionView[]> {
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('radius_accounting')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map(this.rowToSession);
    }
    return memorySessions.slice(0, limit);
  }

  private rowToSession(row: Record<string, unknown>): RadiusSessionView {
    return {
      id: String(row.id),
      username: String(row.username),
      clientId: row.client_id ? String(row.client_id) : undefined,
      nasIp: row.nas_ip ? String(row.nas_ip) : undefined,
      sessionId: row.session_id ? String(row.session_id) : undefined,
      bytesIn: Number(row.bytes_in ?? 0),
      bytesOut: Number(row.bytes_out ?? 0),
      startedAt: String(row.started_at),
      endedAt: row.ended_at ? String(row.ended_at) : undefined,
      status: row.ended_at ? 'closed' : 'active',
    };
  }
}

let cached: RadiusService | null = null;
export const getRadiusService = () => {
  if (!cached) cached = new RadiusService();
  return cached;
};
