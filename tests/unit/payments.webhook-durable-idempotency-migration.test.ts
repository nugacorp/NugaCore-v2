// ====================================================================
// Guardarraíl estático de la migración de idempotencia durable (T5).
//
// La suite es hermética, así que no ejecuta el SQL. Lo que sí puede sostener
// es lo que hace peligrosa a esta migración concreta:
//   - que no sea aditiva (rompería el rollback al binario viejo);
//   - que la unicidad no sea parcial (fabricaría claves para filas históricas);
//   - que las RPC queden ejecutables por anon/authenticated;
//   - que el orden de locks no sea siempre event → action;
//   - que la precedencia sea `already_applied` antes que ownership;
//   - que el CHECK de `reactivation_orders.source` siga rechazando
//     'payment-engine', que es justo lo que escribe el Payment Engine.
// ====================================================================

import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const migrationsDir = new URL('../../supabase/migrations/', import.meta.url);
const durableMigrationFiles = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_webhook_durable_idempotency.sql'),
);
const migrationFile = durableMigrationFiles[0] ?? '';
const sql = migrationFile
  ? readFileSync(new URL(migrationFile, migrationsDir), 'utf8')
  : '';

const IDEMPOTENT_TABLES = [
  'mikrotik_actions',
  'client_timeline',
  'reactivation_orders',
  'suspension_events',
  'noc_alerts',
  'payments',
];

const RPCS = [
  'payments_checkpoint_reactivation_step',
  'billing_apply_webhook_payment',
  'payments_webhook_schema_capability',
];

const positionOf = (needle: RegExp): number => {
  const at = sql.search(needle);
  expect(at, `no se encontró ${needle}`).toBeGreaterThanOrEqual(0);
  return at;
};

describe('Migración de idempotencia durable — invariantes estáticas', () => {
  it('usa una versión única posterior al historial de main', () => {
    expect(durableMigrationFiles).toHaveLength(1);
    expect(Number(migrationFile.slice(0, 14))).toBeGreaterThan(20260730140000);
  });

  it('es aditiva: columnas nullable y ningún CREATE TABLE', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    for (const stmt of sql.match(/ADD COLUMN[^,;]*/gi) ?? []) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i);
      expect(stmt, stmt).not.toMatch(/NOT NULL/i);
    }
  });

  it('estampa tenant_id e idempotency_key en cada destino del flujo', () => {
    for (const table of IDEMPOTENT_TABLES) {
      expect(sql, `${table} sin tenant_id`).toMatch(
        new RegExp(`'${table}'`),
      );
    }
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS idempotency_key TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS payment_event_id TEXT/i);
  });

  it('la unicidad es PARCIAL y tenant-scoped: nunca fabrica claves históricas', () => {
    const uniques = (sql.match(/CREATE UNIQUE INDEX[^;]*/gi) ?? [])
      .filter((stmt) => !/uq_payments_tenant_provider_transaction/i.test(stmt));
    expect(uniques.length).toBeGreaterThan(0);
    for (const stmt of uniques) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i);
      expect(stmt, stmt).toMatch(/\(tenant_id, idempotency_key\)/i);
      expect(stmt, stmt).toMatch(/WHERE idempotency_key IS NOT NULL/i);
    }
    // Ninguna sentencia puede rellenar la clave de filas antiguas.
    expect(sql).not.toMatch(/UPDATE[\s\S]{0,200}SET\s+idempotency_key\s*=/i);
    // El índice legacy de Billing era global sobre idempotency_key; dejarlo
    // vivo anularía la nueva unicidad tenant-scoped.
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.uq_payments_idempotency/i);
  });

  it('los seis destinos del flujo entran en el bucle de identidad durable', () => {
    const loop = sql.slice(
      positionOf(/targets TEXT\[\] := ARRAY\[/),
      positionOf(/CREATE UNIQUE INDEX/),
    );
    for (const table of IDEMPOTENT_TABLES) {
      expect(loop, `${table} fuera del bucle`).toMatch(new RegExp(`'${table}'`));
    }
    // El índice se nombra por tabla, que es justo lo que verifica la capability.
    expect(sql).toMatch(/uq_%s_tenant_idempotency/);
    for (const table of IDEMPOTENT_TABLES) {
      expect(sql, `capability no verifica ${table}`).toMatch(
        new RegExp(`'${table}'[\\s\\S]*?uq_' \\|\\| t \\|\\| '_tenant_idempotency`),
      );
    }
  });

  it('reconcilia el CHECK de reactivation_orders.source para payment-engine', () => {
    expect(sql).toMatch(/reactivation_orders[\s\S]*?DROP CONSTRAINT IF EXISTS/i);
    expect(sql).toMatch(/'payment-engine'/);
    expect(sql).toMatch(/'provisioning-center'/);
    expect(sql).toMatch(/'service-status'/);
  });

  it('crea las tres RPC del contrato', () => {
    for (const rpc of RPCS) {
      expect(sql, `falta ${rpc}`).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}`));
    }
  });

  it('las RPC fijan search_path y no quedan ejecutables por PUBLIC/anon/authenticated', () => {
    for (const rpc of RPCS) {
      expect(sql, `${rpc} sin search_path`).toMatch(
        new RegExp(`FUNCTION public\\.${rpc}[\\s\\S]*?SET search_path`),
      );
      expect(sql, `${rpc} sin REVOKE`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}[^;]*FROM PUBLIC, anon, authenticated`),
      );
      expect(sql, `${rpc} sin GRANT a service_role`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}[^;]*TO service_role`),
      );
    }
  });

  it('el checkpoint bloquea siempre en el orden payment_event → mikrotik_action', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.payments_checkpoint_reactivation_step/));
    const eventLock = body.search(/FROM public\.payment_events[\s\S]*?FOR UPDATE/);
    const actionLock = body.search(/FROM public\.mikrotik_actions[\s\S]*?FOR UPDATE/);
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(actionLock).toBeGreaterThanOrEqual(0);
    expect(eventLock).toBeLessThan(actionLock);
  });

  it('el checkpoint valida ownership ANTES de responder already_applied', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.payments_checkpoint_reactivation_step/));
    const ownership = body.search(/ownership_lost/);
    const already = body.search(/already_applied/);
    expect(ownership).toBeGreaterThanOrEqual(0);
    expect(ownership).toBeLessThan(already);
  });

  it('el checkpoint es set-only: une el paso sin reemplazar el progreso', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.payments_checkpoint_reactivation_step/));
    expect(body).toMatch(/jsonb_set|\|\|/);
    // Una whitelist cerrada evita que un step arbitrario escriba en el JSON.
    expect(body).toMatch(/customerReactivated[\s\S]*?alertCreated/);
    expect(body).toMatch(/RAISE EXCEPTION/);
  });

  it('la RPC de Billing bloquea evento y después factura/ledger', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.billing_apply_webhook_payment/));
    const eventLock = body.search(/FROM public\.payment_events[\s\S]*?FOR UPDATE/);
    const invoiceLock = body.search(/FROM public\.invoices[\s\S]*?FOR UPDATE/);
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(invoiceLock).toBeGreaterThanOrEqual(0);
    expect(eventLock).toBeLessThan(invoiceLock);
    // El total se recalcula desde las aplicaciones, no incrementando un valor leído.
    expect(body).toMatch(/SUM\(applied_cents\)/i);
  });

  it('Billing resuelve la carrera de INSERT por key dentro de la RPC', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.billing_apply_webhook_payment/));
    // Dos eventos distintos pueden llegar a la misma key: sus locks de evento
    // no se serializan entre sí, por lo que el INSERT debe perder la carrera
    // sin abortar la transacción y luego validar la fila ganadora.
    expect(body).toMatch(
      /INSERT INTO public\.payments[\s\S]*?ON CONFLICT\s*\(tenant_id, provider, transaction_id\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING id/i,
    );
    expect(body).toMatch(/IF NOT FOUND[\s\S]*?FROM public\.payments[\s\S]*?FOR UPDATE/i);
  });

  it('Billing tipa status/CFDI con los enums reales y conserva canceled terminal', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.billing_apply_webhook_payment/));
    expect(body).toMatch(/v_status\s+(public\.)?invoice_status/i);
    expect(body).toMatch(/v_cfdi_status\s+(public\.)?cfdi_status/i);
    expect(body).toMatch(/IF\s+v_current_status\s*=\s*'canceled'/i);
    expect(body).toMatch(/cfdi_status\s*=\s*v_cfdi_status/i);
    expect(body).toMatch(/cfdi_uuid\s*=\s*v_cfdi_uuid/i);
  });

  it('los conflictos SQL no imprimen transaction/order ni la key derivada', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.billing_apply_webhook_payment/));
    for (const statement of body.match(/RAISE EXCEPTION[^;]*/gi) ?? []) {
      expect(statement).not.toMatch(/p_transaction_id|p_idempotency_key/i);
    }
  });

  it('impone identidad única tenant + provider + transaction independiente del eventId', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider TEXT/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_provider_transaction[\s\S]*?\(tenant_id, provider, transaction_id\)[\s\S]*?WHERE provider IS NOT NULL AND transaction_id IS NOT NULL/i,
    );
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.billing_apply_webhook_payment/));
    expect(body).toMatch(/p_provider\s+TEXT/i);
    expect(body).toMatch(/tenant_id\s*=\s*p_tenant_id[\s\S]*?provider\s*=\s*p_provider[\s\S]*?transaction_id\s*=\s*p_transaction_id/i);
  });

  it('la capability valida definición real de índices, propiedades de RPC y privilegios', () => {
    const body = sql.slice(positionOf(/CREATE OR REPLACE FUNCTION public\.payments_webhook_schema_capability/));
    expect(body).toMatch(/pg_index/i);
    expect(body).toMatch(/indisunique/i);
    expect(body).toMatch(/pg_get_expr\s*\(/i);
    expect(body).toMatch(/prosecdef/i);
    expect(body).toMatch(/proconfig/i);
    expect(body).toMatch(/has_function_privilege\s*\(\s*'service_role'/i);
    expect(body).toMatch(/has_function_privilege\s*\(\s*'anon'/i);
    expect(body).toMatch(/has_function_privilege\s*\(\s*'authenticated'/i);
    expect(body).toMatch(/aclexplode/i);
    expect(body).toMatch(/grantee\s*=\s*0/i);
  });

  it('es reejecutable: índices con guarda y funciones CREATE OR REPLACE', () => {
    for (const stmt of sql.match(/CREATE (UNIQUE )?INDEX[^;]*/gi) ?? []) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i);
    }
    for (const stmt of sql.match(/CREATE FUNCTION[^;]*/gi) ?? []) {
      expect(stmt, stmt).toMatch(/OR REPLACE/i);
    }
  });
});
