import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION =
  'supabase/migrations/20260724195354_allow_factory_router_enrollment_template.sql';
const sql = readFileSync(MIGRATION, 'utf8');

describe('router enrollment Factory template migration', () => {
  it('recrea el constraint de forma idempotente e incluye Factory y templates legacy', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.router_enrollment\s+DROP CONSTRAINT IF EXISTS chk_enrollment_template_id/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.router_enrollment\s+ADD CONSTRAINT chk_enrollment_template_id/i,
    );
    for (const templateId of [
      'nugacore_factory_onboarding',
      'router_base_wireguard',
      'tower_wisp',
      'pcc_2wan',
      'pcc_3wan',
      'pcc_4wan',
      'pcc_5wan',
      'pppoe_server',
      'noc_ready',
      'monitoring_agent',
    ]) {
      expect(sql, `falta template ${templateId}`).toContain(`'${templateId}'`);
    }
  });

  it('no modifica datos ni elimina columnas/tablas', () => {
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)\b/i);
  });
});
