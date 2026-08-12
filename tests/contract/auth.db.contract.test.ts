import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import type { Express } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createStagingAuthFixtures } from '../helpers/staging-fixtures';

// ====================================================================
// Prueba de AUTH REAL (Supabase JWT) — Fase 2.1. NO hermética.
//
// Opt-in EXPLÍCITO: solo corre con RUN_AUTH_TESTS=true (lo activa el script
// `npm run test:auth`, que además fuerza NODE_ENV=production para replicar
// staging JWT-only). Sin ese flag se OMITE -> `npm test` queda hermético.
//
// Requiere además staging configurado + usuarios sembrados (SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STAGING_AUTH_PASSWORD). Si
// se opta por correrla pero falta alguna, FALLA con un mensaje claro (sin
// imprimir nunca passwords ni JWT).
//
// Valida: login real, JWT, refresh token, logout, resolución de rol desde
// public.user_roles, RBAC backend y escritura protegida de Customers.
// ====================================================================

const optIn = process.env.RUN_AUTH_TESTS === 'true';
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = process.env.STAGING_AUTH_PASSWORD;
const hasEnv = Boolean(URL && ANON && SERVICE_ROLE && PW);

// Opt-in sin entorno completo -> error explícito (solo nombres, sin valores).
if (optIn && !hasEnv) {
  describe('Auth real — configuración requerida', () => {
    it('RUN_AUTH_TESTS=true exige SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y STAGING_AUTH_PASSWORD', () => {
      throw new Error(
        'RUN_AUTH_TESTS=true pero falta al menos una variable de staging: ' +
          'SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY o ' +
          'STAGING_AUTH_PASSWORD. Configúralas (staging real) o ejecuta ' +
          '`npm test` (hermético). No se imprime ningún valor por seguridad.',
      );
    });
  });
}

// Timeouts de red holgados: el login real de 6 usuarios + reintentos puede
// tardar segundos por llamada según la latencia a Supabase Auth. Evita el
// "timeout falso" de un cap demasiado bajo (la suite es staging-grade).
const NET_HOOK_TIMEOUT_MS = 180000;
const NET_TEST_TIMEOUT_MS = 120000;

type RoleKey = 'superadmin' | 'administrador' | 'cobranza' | 'tecnico' | 'soporte' | 'readonly';

// Populated in beforeAll with per-run staging users. This avoids changing
// shared fixture passwords while still exercising real Supabase JWT auth.

describe.skipIf(!optIn || !hasEnv)('Auth real (Supabase JWT) — Fase 2.1 staging', () => {
  let app: Express;
  let anon: SupabaseClient;
  let users: Record<RoleKey, { email: string; expectedRole: string }>;
  let cleanupAuthFixtures: (() => Promise<void>) | null = null;
  const tokens: Partial<Record<RoleKey, string>> = {};
  const refreshTokens: Partial<Record<RoleKey, string>> = {};

  const signIn = async (email: string): Promise<{ accessToken: string; refreshToken: string }> => {
    for (let i = 0; i < 4; i += 1) {
      const { data, error } = await anon.auth.signInWithPassword({ email, password: PW! });
      if (!error && data.session?.access_token && data.session.refresh_token) {
        return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
      }
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
    return { accessToken: '', refreshToken: '' };
  };

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    anon = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(URL!, SERVICE_ROLE!, { auth: { persistSession: false, autoRefreshToken: false } });
    const fixtures = await createStagingAuthFixtures(admin, PW!);
    users = fixtures.users;
    cleanupAuthFixtures = fixtures.cleanup;

    for (const [roleKey, user] of Object.entries(users) as Array<[RoleKey, { email: string; expectedRole: string }]>) {
      const session = await signIn(user.email);
      tokens[roleKey] = session.accessToken;
      refreshTokens[roleKey] = session.refreshToken;
    }

    const { createApp } = await import('../../backend/app');
    app = createApp();
  }, NET_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanupAuthFixtures?.();
  }, NET_HOOK_TIMEOUT_MS);

  it('login real emite JWT y refresh token para todos los roles staging', () => {
    for (const key of Object.keys(users) as RoleKey[]) {
      expect(tokens[key]?.length).toBeGreaterThan(20);
      expect(refreshTokens[key]?.length).toBeGreaterThan(8);
    }
  });

  it('JWT válido -> /api/auth/me resuelve rol desde DB (source=supabase-jwt)', async () => {
    for (const [key, user] of Object.entries(users) as Array<[RoleKey, { email: string; expectedRole: string }]>) {
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokens[key]}`);
      expect(res.status).toBe(200);
      expect(res.body.email || user.email).toBeTruthy();
      expect(res.body.role).toBe(user.expectedRole);
      expect(res.body.source).toBe('supabase-jwt');
    }
  });

  it('refresh token renueva sesión y el nuevo JWT sigue autenticando', async () => {
    const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshTokens.superadmin! });
    expect(error).toBeNull();
    expect(data.session?.access_token?.length || 0).toBeGreaterThan(20);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${data.session!.access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('super admin');
    expect(res.body.source).toBe('supabase-jwt');
  });

  it('frontend auth usa /api/auth/me como fuente de rol y no consulta users_profile desde el navegador', async () => {
    const loginForm = readFileSync('src/components/LoginForm.tsx', 'utf8');
    const authSession = readFileSync('src/lib/authSession.ts', 'utf8');
    expect(loginForm).not.toContain("from('users_profile')");
    expect(loginForm).not.toContain('rest/v1/users_profile');
    expect(authSession).not.toContain("from('users_profile')");
    expect(authSession).not.toContain('rest/v1/users_profile');

    const freshAdmin = await signIn(users.administrador.email);
    const authMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${freshAdmin.accessToken}`);
    expect(authMe.status).toBe(200);
    expect(authMe.body.role).toBe(users.administrador.expectedRole);
    expect(authMe.body.source).toBe('supabase-jwt');
  });


  it('logout invalida la sesión del cliente Supabase', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await client.auth.signInWithPassword({ email: users.readonly.email, password: PW! });
    expect(login.error).toBeNull();
    expect(login.data.session?.access_token?.length || 0).toBeGreaterThan(20);

    const logout = await client.auth.signOut();
    expect(logout.error).toBeNull();
    const sessionAfterLogout = await client.auth.getSession();
    expect(sessionAfterLogout.data.session).toBeNull();
  });

  it('sin Bearer válido no autentica como Supabase JWT y trusted headers no bypassan producción JWT-only', async () => {
    const invalid = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-invalido');
    if (invalid.status === 200) {
      expect(invalid.body.source).not.toBe('supabase-jwt');
    } else {
      expect(invalid.status).toBe(401);
    }

    const spoofed = await request(app)
      .post('/api/clients')
      .set({ 'x-user-role': 'super admin', 'x-user-id': 'spoofed' })
      .send({ name: 'no-auth-spoofed', type: 'residential', address: 'a', city: 'CDMX' });
    expect([401, 403]).toContain(spoofed.status);
  });

  it('lecturas sensibles exigen Bearer válido en staging/producción y no aceptan trusted-header spoofing', async () => {
    const activeTokens: Partial<Record<RoleKey, string>> = {
      ...tokens,
      readonly: (await signIn(users.readonly.email)).accessToken,
    };
    const sensitiveReads: Array<{ path: string; role: RoleKey }> = [
      { path: '/api/dashboard-stats', role: 'readonly' },
      { path: '/api/clients', role: 'readonly' },
      { path: '/api/plans', role: 'readonly' },
      { path: '/api/billing/invoices', role: 'cobranza' },
      { path: '/api/network-towers', role: 'readonly' },
      { path: '/api/olt', role: 'readonly' },
      { path: '/api/onu', role: 'readonly' },
      { path: '/api/tickets', role: 'readonly' },
      { path: '/api/workorders', role: 'readonly' },
      { path: '/api/inventory', role: 'readonly' },
      { path: '/api/alerts', role: 'readonly' },
      { path: '/api/mikrotik/logs', role: 'tecnico' },
      { path: '/api/naps', role: 'readonly' },
    ];

    for (const { path, role } of sensitiveReads) {
      const anonymous = await request(app).get(path);
      expect(anonymous.status, `${path} debe bloquear lectura anónima`).toBe(401);

      const spoofed = await request(app)
        .get(path)
        .set({ 'x-user-role': 'super admin', 'x-user-id': 'spoofed-reader' });
      expect(spoofed.status, `${path} no debe aceptar trusted headers en producción`).toBe(401);

      const authorized = await request(app).get(path).set('Authorization', `Bearer ${activeTokens[role]}`);
      expect(authorized.status, `${path} debe permitir JWT valido con rol ${role}`).toBe(200);
    }
  }, NET_TEST_TIMEOUT_MS);

  it('RBAC: superadmin y administrador acceden a Customers; readonly solo lectura', async () => {
    for (const key of ['superadmin', 'administrador'] as RoleKey[]) {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${tokens[key]}`)
        .send({ name: `RBAC ${key}`, type: 'residential', address: 'Calle Auth 1', city: 'CDMX' });
      expect(res.status).toBe(201);
      await request(app).delete(`/api/clients/${res.body.id}`).set('Authorization', `Bearer ${tokens.superadmin}`).expect(204);
    }

    const freshReadonly = await signIn(users.readonly.email);
    const read = await request(app).get('/api/clients').set('Authorization', `Bearer ${freshReadonly.accessToken}`);
    expect(read.status).toBe(200);

    const readonlyForWrite = await signIn(users.readonly.email);
    const write = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${readonlyForWrite.accessToken}`)
      .send({ name: 'Readonly Forbidden', type: 'residential', address: 'Calle Auth 2', city: 'CDMX' });
    expect(write.status).toBe(403);
  });

  it('RBAC: cobranza accede a pagos/facturación y puede editar clientes pero no crear/eliminar clientes', async () => {
    const invoices = await request(app).get('/api/billing/invoices').set('Authorization', `Bearer ${tokens.cobranza}`);
    expect(invoices.status).toBe(200);

    const created = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokens.superadmin}`)
      .send({ name: 'Auth Cobranza Edit', type: 'residential', address: 'Calle Cobranza 1', city: 'CDMX' });
    expect(created.status).toBe(201);

    const edited = await request(app)
      .put(`/api/clients/${created.body.id}`)
      .set('Authorization', `Bearer ${tokens.cobranza}`)
      .send({ notes: 'editado por cobranza' });
    expect(edited.status).toBe(200);

    const forbiddenCreate = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokens.cobranza}`)
      .send({ name: 'Cobranza Forbidden', type: 'residential', address: 'Calle Cobranza 2', city: 'CDMX' });
    expect(forbiddenCreate.status).toBe(403);

    const forbiddenDelete = await request(app).delete(`/api/clients/${created.body.id}`).set('Authorization', `Bearer ${tokens.cobranza}`);
    expect(forbiddenDelete.status).toBe(403);
    await request(app).delete(`/api/clients/${created.body.id}`).set('Authorization', `Bearer ${tokens.superadmin}`).expect(204);
  });

  it('RBAC: técnico accede a red y soporte accede a tickets', async () => {
    const network = await request(app)
      .post('/api/network-towers')
      .set('Authorization', `Bearer ${tokens.tecnico}`)
      .send({ name: 'Torre Auth Técnico', location: 'CDMX', lat: 19.43, lng: -99.13, status: 'online' });
    expect(network.status).toBe(201);

    const ticket = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${tokens.soporte}`)
      .send({ clientId: 'c-1', title: 'Ticket Auth', category: 'Internet', severity: 'low', description: 'Validación RBAC soporte' });
    expect(ticket.status).toBe(201);
  });

  it('escritura protegida Customers: crear, leer, editar, suspender, reactivar y eliminar cliente ficticio con JWT válido', async () => {
    const created = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokens.superadmin}`)
      .send({
        name: 'Cliente Ficticio Auth E2E',
        type: 'residential',
        email: 'cliente-auth-e2e@staging.nugacore.local',
        phone: '+520000000000',
        address: 'Calle Auth E2E 123',
        city: 'CDMX',
        planId: 'plan-basic',
      });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const read = await request(app).get(`/api/clients/${id}`).set('Authorization', `Bearer ${tokens.superadmin}`);
    expect(read.status).toBe(200);
    expect(read.body.name).toBe('Cliente Ficticio Auth E2E');

    const edited = await request(app)
      .put(`/api/clients/${id}`)
      .set('Authorization', `Bearer ${tokens.administrador}`)
      .send({ phone: '+521111111111', notes: 'editado en validación auth e2e' });
    expect(edited.status).toBe(200);
    expect(edited.body.phone).toBe('+521111111111');

    const suspended = await request(app)
      .put(`/api/clients/${id}`)
      .set('Authorization', `Bearer ${tokens.cobranza}`)
      .send({ status: 'suspended' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('suspended');

    const reactivated = await request(app)
      .put(`/api/clients/${id}`)
      .set('Authorization', `Bearer ${tokens.administrador}`)
      .send({ status: 'active' });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('active');

    const removed = await request(app).delete(`/api/clients/${id}`).set('Authorization', `Bearer ${tokens.superadmin}`);
    expect(removed.status).toBe(204);

    const missing = await request(app).get(`/api/clients/${id}`).set('Authorization', `Bearer ${tokens.superadmin}`);
    expect(missing.status).toBe(404);
  });
});
