import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const QUEUE = readFileSync('supabase/migrations/20260729130000_olt_actions_and_credentials.sql', 'utf8');
const WO = readFileSync('supabase/migrations/20260729140000_work_orders_ftth_checklist.sql', 'utf8');
const GEO = readFileSync('supabase/migrations/20260729120000_nap_boxes_geo_index.sql', 'utf8');

describe('Migración olt_actions + olt_credentials', () => {
  it('crea ambas tablas de forma idempotente', () => {
    expect(QUEUE).toMatch(/CREATE TABLE IF NOT EXISTS public\.olt_actions/i);
    expect(QUEUE).toMatch(/CREATE TABLE IF NOT EXISTS public\.olt_credentials/i);
  });

  it('todos los índices llevan IF NOT EXISTS', () => {
    const bad = QUEUE.split('\n').filter(
      (l) => /create\s+(unique\s+)?index/i.test(l) && !/if not exists/i.test(l),
    );
    expect(bad, `índices sin IF NOT EXISTS: ${bad.join(' | ')}`).toHaveLength(0);
  });

  it('arranca en dry_run y acota los tipos de acción', () => {
    expect(QUEUE).toMatch(/dry_run\s+BOOLEAN\s+NOT NULL DEFAULT true/i);
    for (const action of ['provision_onu', 'deauthorize_onu', 'suspend_onu', 'restore_onu', 'reboot_onu']) {
      expect(QUEUE).toContain(`'${action}'`);
    }
  });

  it('las credenciales se guardan cifradas y solo una activa por OLT', () => {
    expect(QUEUE).toMatch(/encrypted_password\s+TEXT\s+NOT NULL/i);
    expect(QUEUE).toMatch(/encryption_version\s+TEXT\s+NOT NULL DEFAULT 'v1-aes-256-gcm'/i);
    expect(QUEUE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_olt_credentials_active_unique[\s\S]*WHERE is_active/i,
    );
  });

  it('mantiene RLS deny-by-default con política service_role en ambas tablas', () => {
    expect(QUEUE.match(/ENABLE ROW LEVEL SECURITY/gi)).toHaveLength(2);
    expect(QUEUE).toContain('olt_actions_service_role');
    expect(QUEUE).toContain('olt_credentials_service_role');
    expect(QUEUE).not.toMatch(/TO authenticated/i);
  });

  it('es multi-tenant con FK indexada', () => {
    expect(QUEUE).toMatch(/tenant_id\s+TEXT\s+NOT NULL DEFAULT 'tenant-default'/i);
    expect(QUEUE).toMatch(/CREATE INDEX IF NOT EXISTS idx_olt_actions_tenant/i);
    expect(QUEUE).toMatch(/CREATE INDEX IF NOT EXISTS idx_olt_credentials_tenant/i);
  });

  it('no es destructiva', () => {
    expect(QUEUE).not.toMatch(/DROP TABLE|DROP COLUMN/i);
  });
});

describe('Migración de checklist FTTH en work_orders', () => {
  it('es evolutiva: ADD COLUMN IF NOT EXISTS, sin recrear la tabla', () => {
    expect(WO).toMatch(/ALTER TABLE public\.work_orders[\s\S]*ADD COLUMN IF NOT EXISTS technology/i);
    expect(WO).toMatch(/ADD COLUMN IF NOT EXISTS ftth_data JSONB/i);
    expect(WO).not.toMatch(/CREATE TABLE/i);
    expect(WO).not.toMatch(/DROP TABLE|DROP COLUMN/i);
  });

  it('acota technology y deja NULL para las órdenes previas', () => {
    expect(WO).toMatch(/CHECK \(technology IS NULL OR technology IN \('radio', 'fiber'\)\)/i);
    expect(WO).not.toMatch(/SET NOT NULL/i);
  });
});

describe('Migración del índice geográfico de NAPs', () => {
  it('tolera entornos sin la columna tenant_id', () => {
    expect(GEO).toMatch(/information_schema\.columns/i);
    expect(GEO).toMatch(/idx_nap_boxes_tenant_geo/);
    expect(GEO).toMatch(/idx_nap_boxes_geo/);
  });
});
