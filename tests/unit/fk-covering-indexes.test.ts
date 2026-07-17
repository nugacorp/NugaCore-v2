import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260717030000_index_unindexed_foreign_keys.sql'),
  'utf8',
);

describe('FK covering indexes migration', () => {
  it('crea índices IF NOT EXISTS para FKs del advisor', () => {
    const expected = [
      'idx_audit_logs_user_id',
      'idx_cash_register_entries_client_id',
      'idx_client_documents_client_id',
      'idx_invoice_items_invoice_id',
      'idx_ticket_messages_ticket_id',
      'idx_user_roles_role_id',
      'idx_wireguard_ip_allocations_peer_id',
      'idx_work_order_history_work_order_id',
    ];
    for (const name of expected) {
      expect(sql).toMatch(new RegExp(`CREATE INDEX IF NOT EXISTS ${name}`, 'i'));
    }
  });

  it('documenta que unused_index no se dropea a ciegas', () => {
    expect(sql).toMatch(/unused_index/i);
    expect(sql).toMatch(/NO se eliminan/i);
  });
});
