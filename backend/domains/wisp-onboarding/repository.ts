import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../common/logger';
import type { OnboardingStep, OnboardingStatus, WispOnboardingRow, WispOnboardingState } from './types';

const TABLE = 'wisp_onboarding';

const asSteps = (raw: unknown): OnboardingStep[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is OnboardingStep =>
    s === 'company' || s === 'zone' || s === 'billing' || s === 'router' || s === 'done');
};

export const rowToState = (row: WispOnboardingRow): WispOnboardingState => ({
  tenantId: String(row.tenant_id),
  status: (row.status === 'completed' ? 'completed' : 'in_progress') as OnboardingStatus,
  currentStep: (row.current_step || 'company') as OnboardingStep,
  companyName: row.company_name || undefined,
  contactEmail: row.contact_email || undefined,
  contactPhone: row.contact_phone || undefined,
  city: row.city || undefined,
  zoneName: row.zone_name || undefined,
  zoneTowerId: row.zone_tower_id || undefined,
  billingCycleDay: row.billing_cycle_day != null ? Number(row.billing_cycle_day) : undefined,
  billingCycleTime: row.billing_cycle_time || undefined,
  firstRouterId: row.first_router_id || undefined,
  firstRouterName: row.first_router_name || undefined,
  completedSteps: asSteps(row.completed_steps),
  completedAt: row.completed_at || undefined,
  updatedAt: row.updated_at || new Date().toISOString(),
});

export interface WispOnboardingRepository {
  get(tenantId: string): Promise<WispOnboardingState | null>;
  upsert(state: WispOnboardingState): Promise<WispOnboardingState>;
}

export class StoreWispOnboardingRepository implements WispOnboardingRepository {
  private rows = new Map<string, WispOnboardingState>();

  async get(tenantId: string) {
    return this.rows.get(tenantId) ?? null;
  }

  async upsert(state: WispOnboardingState) {
    const next = { ...state, updatedAt: new Date().toISOString() };
    this.rows.set(state.tenantId, next);
    return next;
  }

  reset() {
    this.rows.clear();
  }
}

export class SupabaseWispOnboardingRepository implements WispOnboardingRepository {
  constructor(private readonly client: SupabaseClient) {}

  async get(tenantId: string) {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) {
      logger.error('wisp_onboarding get failed', { message: error.message });
      throw new Error(`Onboarding DB error: ${error.message}`);
    }
    return data ? rowToState(data as WispOnboardingRow) : null;
  }

  async upsert(state: WispOnboardingState) {
    const row = {
      tenant_id: state.tenantId,
      status: state.status,
      current_step: state.currentStep,
      company_name: state.companyName ?? null,
      contact_email: state.contactEmail ?? null,
      contact_phone: state.contactPhone ?? null,
      city: state.city ?? null,
      zone_name: state.zoneName ?? null,
      zone_tower_id: state.zoneTowerId ?? null,
      billing_cycle_day: state.billingCycleDay ?? null,
      billing_cycle_time: state.billingCycleTime ?? null,
      first_router_id: state.firstRouterId ?? null,
      first_router_name: state.firstRouterName ?? null,
      completed_steps: state.completedSteps,
      completed_at: state.completedAt ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.client
      .from(TABLE)
      .upsert(row, { onConflict: 'tenant_id' })
      .select('*')
      .single();
    if (error) {
      logger.error('wisp_onboarding upsert failed', { message: error.message });
      throw new Error(`Onboarding DB error: ${error.message}`);
    }
    return rowToState(data as WispOnboardingRow);
  }
}
