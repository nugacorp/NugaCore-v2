// ====================================================================
// Destino idempotente de alertas NOC para el flujo de webhook (T5).
//
// Antes, la reactivación por pago sólo creaba alerta cuando Customers NO
// usaba base de datos: en modo Supabase el efecto simplemente no existía, así
// que no había nada que hacer idempotente ni que revisar después. Aquí la
// alerta pasa a ser un efecto de primera clase con la misma identidad durable
// `actionId + step` que el resto, y con adapter real en ambos backends.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NocAlert } from '../../../src/types';
import { IdempotencyConflictError, IdempotencyResolutionError } from '../../common/errors';
import { tenantScopedIdempotencyId } from '../../common/idempotency';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { store } from '../../state/store';

export const ALERT_IDEMPOTENCY_SCOPE = 'noc_alerts';

export interface WebhookAlertInput {
  tenantId: string;
  idempotencyKey: string;
  sourceType: NocAlert['sourceType'];
  severity: NocAlert['severity'];
  source: string;
  message: string;
}

export type AlertWriteOutcome = 'created' | 'existing';

export interface AlertSink {
  createAlertIdempotent(input: WebhookAlertInput): Promise<AlertWriteOutcome>;
}

const isUniqueViolation = (error: { code?: string; message?: string }): boolean =>
  String(error?.code) === '23505' || /duplicate key|already exists/i.test(String(error?.message ?? ''));

export class StoreAlertSink implements AlertSink {
  async createAlertIdempotent(input: WebhookAlertInput): Promise<AlertWriteOutcome> {
    // Sin `await` entre la búsqueda y el push: atómico frente a otro owner.
    const existing = store.NOC_ALERTS.find(
      (alert) =>
        (alert.tenantId || 'tenant-default') === input.tenantId
        && alert.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (
        existing.message !== input.message
        || existing.source !== input.source
        || existing.sourceType !== input.sourceType
        || existing.severity !== input.severity
      ) {
        throw new IdempotencyConflictError(ALERT_IDEMPOTENCY_SCOPE, input.idempotencyKey);
      }
      return 'existing';
    }
    store.NOC_ALERTS.unshift({
      id: tenantScopedIdempotencyId('alt', input.tenantId, input.idempotencyKey),
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      sourceType: input.sourceType,
      severity: input.severity,
      message: input.message,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      acknowledged: false,
    });
    return 'created';
  }
}

export class SupabaseAlertSink implements AlertSink {
  constructor(private readonly client: SupabaseClient) {}

  async createAlertIdempotent(input: WebhookAlertInput): Promise<AlertWriteOutcome> {
    const row = {
      id: tenantScopedIdempotencyId('alt', input.tenantId, input.idempotencyKey),
      tenant_id: input.tenantId,
      idempotency_key: input.idempotencyKey,
      source: input.source,
      source_type: input.sourceType,
      severity: input.severity,
      message: input.message,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };

    const { error } = await this.client.from('noc_alerts').insert(row);
    if (!error) return 'created';
    if (!isUniqueViolation(error)) throw new Error(`createAlertIdempotent: ${error.message}`);

    const { data, error: readError } = await this.client
      .from('noc_alerts').select('id, message, source, source_type, severity')
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    if (readError) throw new Error(`createAlertIdempotent(read): ${readError.message}`);
    if (!data) throw new IdempotencyResolutionError(ALERT_IDEMPOTENCY_SCOPE, input.idempotencyKey);
    if (
      data.message !== input.message
      || data.source !== input.source
      || data.source_type !== input.sourceType
      || data.severity !== input.severity
    ) {
      throw new IdempotencyConflictError(ALERT_IDEMPOTENCY_SCOPE, input.idempotencyKey);
    }
    return 'existing';
  }
}

// ── Selección de backend ──────────────────────────────────────────────
//
// Las alertas viven en la superficie NOC/cliente y no tienen flag propia; se
// alinean con `USE_DB_CUSTOMERS`, que es la que hoy decide si este flujo
// escribe en el store o en Postgres.

let singleton: AlertSink | null = null;

export const getAlertSink = (): AlertSink => {
  if (singleton) return singleton;
  if (isDomainOnDb('customers')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error('USE_DB_CUSTOMERS=true pero Supabase no está configurado (alertas NOC).');
    }
    singleton = new SupabaseAlertSink(supabaseAdmin);
    return singleton;
  }
  singleton = new StoreAlertSink();
  return singleton;
};

export const resetAlertSink = (): void => { singleton = null; };
