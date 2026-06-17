// ====================================================================
// Router Enrollment — contrato modo DB (Supabase real). NO hermético.
//
// Opt-in EXPLÍCITO: solo corre con RUN_DB_TESTS=true (npm run test:db).
// Sin ese flag se OMITE, para que `npm test` sea hermético.
//
// Verifica que con USE_DB_ROUTER_ENROLLMENT=true los enrollments persisten
// en public.router_enrollment, incluyendo template_id y template_parameters
// (JSONB), y que sobreviven un "reinicio lógico" (reset del repositorio).
//
// NO ejecuta RouterOS real. NO activa el Worker live. WireGuard usa el store
// (USE_DB_WIREGUARD se mantiene como esté; el peer vive en memoria).
// ====================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../../backend/app';
import { resetEnrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import { resetWireguardService } from '../../backend/domains/wireguard/service';
import { store } from '../../backend/state/store';

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const DB_TIMEOUT_MS = 30000;

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'enr-db-admin' };
const SECRET = 'PPPoEdbSecret123';

if (optIn && !hasSupabase) {
  describe('Router Enrollment DB contract — configuración requerida', () => {
    it('RUN_DB_TESTS=true exige SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY', () => {
      throw new Error(
        'RUN_DB_TESTS=true pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.',
      );
    });
  });
}

describe.skipIf(!optIn || !hasSupabase)('Router Enrollment DB contract (Supabase staging)', () => {
  let app: Express;
  let serverId: string;
  const createdIds: string[] = [];
  // Cliente lazy: se construye en beforeAll para no ejecutarse al recolectar
  // el describe cuando la suite está skipped (sin credenciales). Tipado laxo:
  // es acceso directo de verificación a staging, no parte del contrato público.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any;

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    process.env.USE_DB_ROUTER_ENROLLMENT = 'true';
    resetEnrollmentRepository();   // reconstruye repo → Supabase
    resetWireguardService();       // WG en store (peer en memoria)
    app = createApp();

    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN DB Test', endpointHost: 'vpn.db.local', endpointPort: 13231, isDefault: true });
    expect(srv.status).toBe(201);
    serverId = srv.body.server.id;
  }, DB_TIMEOUT_MS);

  afterAll(async () => {
    // Limpieza: borra solo las filas creadas por este test.
    if (createdIds.length) {
      await supabase.from('router_enrollment').delete().in('id', createdIds);
    }
    process.env.USE_DB_ROUTER_ENROLLMENT = 'false';
    resetEnrollmentRepository();
  }, DB_TIMEOUT_MS);

  const startPcc = async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: `DB PCC ${Date.now()}`,
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_2wan',
        templateParameters: {
          lanCidr: '10.99.0.1/24',
          wan1: { mode: 'dhcp', interface: 'ether1' },
          wan2: { mode: 'pppoe', interface: 'ether2', username: 'cliente', password: SECRET },
        },
      });
    if (res.status === 201) createdIds.push(res.body.enrollment.id);
    return res;
  };

  it('1. crea enrollment con templateParameters → 201 y persiste', async () => {
    const res = await startPcc();
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('pcc_2wan');
    // Verificación directa en DB (JSONB no nulo).
    const { data } = await supabase
      .from('router_enrollment')
      .select('template_id, template_parameters')
      .eq('id', res.body.enrollment.id)
      .single();
    expect(data?.template_id).toBe('pcc_2wan');
    expect(data?.template_parameters?.lanCidr).toBe('10.99.0.1/24');
  }, DB_TIMEOUT_MS);

  it('2. GET /:id lee desde DB con templateParameters (secreto redactado)', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(get.body.templateParameters.lanCidr).toBe('10.99.0.1/24');
    expect(get.body.templateParameters.wan2.password).toBe('<REDACTED>');
    expect(JSON.stringify(get.body)).not.toContain(SECRET);
  }, DB_TIMEOUT_MS);

  it('3. GET / lista incluye el enrollment persistido', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;
    const list = await request(app).get('/api/router-enrollment').set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.some((e: { id: string }) => e.id === id)).toBe(true);
  }, DB_TIMEOUT_MS);

  it('4+8. tras reinicio lógico (reset repo), download regenera con params persistidos', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;

    // Reinicio lógico: el store en memoria se perdería; la DB no.
    resetEnrollmentRepository();

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('10.99.0.1'); // LAN persistida
    expect(dl.text).not.toContain(SECRET);  // secreto nunca en el script
  }, DB_TIMEOUT_MS);

  it('5. download actualiza script_downloaded_at y estado', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;
    await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.body.scriptDownloadedAt).toBeTruthy();
    expect(get.body.status).toBe('script_downloaded');
  }, DB_TIMEOUT_MS);

  it('6. checkOnline con worker simulado deja waiting_for_router (no online)', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;
    const res = await request(app).post(`/api/router-enrollment/${id}/check-online`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(false);
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.body.status).not.toBe('online');
  }, DB_TIMEOUT_MS);

  it('7. revoke marca revoked en DB', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;
    const res = await request(app).post(`/api/router-enrollment/${id}/revoke`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
    const { data } = await supabase.from('router_enrollment').select('status').eq('id', id).single();
    expect(data?.status).toBe('revoked');
  }, DB_TIMEOUT_MS);

  it('9. la fila DB NO contiene script (solo script_hash)', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;
    const { data } = await supabase.from('router_enrollment').select('*').eq('id', id).single();
    expect(data).not.toHaveProperty('script');
    expect(data?.script_hash).toBeTruthy();
  }, DB_TIMEOUT_MS);

  it('10. router_snapshot persiste y download regenera tras restart sin store de routers', async () => {
    const start = await startPcc();
    const id = start.body.enrollment.id;

    // router_snapshot persistido en DB y NO sensible.
    const { data } = await supabase
      .from('router_enrollment')
      .select('router_snapshot')
      .eq('id', id)
      .single();
    expect(data?.router_snapshot?.routerName).toBeTruthy();
    expect(JSON.stringify(data?.router_snapshot || {})).not.toMatch(/password|private-key|preshared/i);

    // Restart lógico real: el repo se reconstruye (lee de Supabase) y el store
    // de routers (memoria) se vacía → download SOLO puede usar el snapshot.
    resetEnrollmentRepository();
    store.MIKROTIK_ROUTERS.length = 0;

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('10.99.0.1'); // LAN persistida en templateParameters
    expect(dl.text).not.toContain(SECRET);  // secreto nunca en el script
  }, DB_TIMEOUT_MS);

  // Crea su PROPIO servidor WG (para poder resetear el WG store sin afectar a
  // los demás casos) y arranca un enrollment con la plantilla indicada.
  const startFresh = async (templateId: string, templateParameters?: Record<string, unknown>) => {
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: `VPN ${templateId} ${Date.now()}`, endpointHost: 'vpn.dbfix.local', endpointPort: 13231, isDefault: true });
    expect(srv.status).toBe(201);
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: `DB ${templateId} ${Date.now()}`, wgServerId: srv.body.server.id, routerosVersion: '7', templateId, templateParameters });
    if (res.status === 201) createdIds.push(res.body.enrollment.id);
    return res;
  };

  it('11. pcc_5wan: download tras restart total NO depende del WireGuard store', async () => {
    const start = await startFresh('pcc_5wan', {
      lanCidr: '10.50.0.1/24',
      wan1: { mode: 'dhcp', interface: 'ether1' },
      wan2: { mode: 'pppoe', interface: 'ether2', username: 'cli', password: SECRET },
    });
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    // Restart total: repo desde DB, router store vacío, WG store vacío.
    resetEnrollmentRepository();
    store.MIKROTIK_ROUTERS.length = 0;
    resetWireguardService();

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);                // NO "Servidor WireGuard no encontrado"
    expect(dl.text).toContain('10.50.0.1');     // LAN persistida
    expect(dl.text).not.toContain(SECRET);
  }, DB_TIMEOUT_MS);

  it('12. router_base_wireguard: download tras restart regenera vía snapshot WG cifrado', async () => {
    const start = await startFresh('router_base_wireguard');
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    resetEnrollmentRepository();
    store.MIKROTIK_ROUTERS.length = 0;
    resetWireguardService();

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('NugaCoreWG');    // tunnel WG regenerado desde el snapshot
  }, DB_TIMEOUT_MS);

  it('13. wireguard_snapshot: secretos CIFRADOS en DB, redactados en la view', async () => {
    const start = await startFresh('router_base_wireguard');
    const id = start.body.enrollment.id;

    // DB: secretos cifrados (formato iv.tag.ct), nunca en claro.
    const { data } = await supabase
      .from('router_enrollment')
      .select('wireguard_snapshot')
      .eq('id', id)
      .single();
    expect(data?.wireguard_snapshot?.hasEncryptedSecrets).toBe(true);
    expect(data?.wireguard_snapshot?.encryptedPeerPrivateKey).toBeTruthy();

    // View: sin campos cifrados ni claves.
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.body.wireguardSnapshot).toBeDefined();
    expect(get.body.wireguardSnapshot).not.toHaveProperty('encryptedPeerPrivateKey');
    expect(get.body.wireguardSnapshot).not.toHaveProperty('encryptedPresharedKey');
    expect(JSON.stringify(get.body)).not.toMatch(/encryptedPeerPrivateKey|encryptedPresharedKey/);
  }, DB_TIMEOUT_MS);
});
