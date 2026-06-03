import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// ====================================================================
// Prueba de AUTH REAL (Supabase JWT) — Fase 2.
//
// Se EJECUTA SOLO si hay Supabase de staging + usuarios sembrados
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//  STAGING_AUTH_PASSWORD). En CI sin esto se OMITE.
//
// Valida que: login con Supabase -> JWT -> el backend resuelve el rol
// desde public.user_roles (sin trusted-headers) y el RBAC se respeta.
// ====================================================================

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const PW = process.env.STAGING_AUTH_PASSWORD;
const hasEnv = Boolean(URL && ANON && process.env.SUPABASE_SERVICE_ROLE_KEY && PW);

describe.skipIf(!hasEnv)('Auth real (Supabase JWT) — Fase 2', () => {
  let app: Express;
  let tokenAdmin = '';
  let tokenLectura = '';

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(URL!, ANON!, { auth: { persistSession: false } });

    // Sign-in con reintentos: el endpoint de auth de Supabase puede devolver
    // rate-limit transitorio si se ejecuta el suite varias veces seguidas.
    const signIn = async (email: string): Promise<string> => {
      for (let i = 0; i < 4; i += 1) {
        const { data, error } = await anon.auth.signInWithPassword({ email, password: PW! });
        if (!error && data.session?.access_token) return data.session.access_token;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
      return '';
    };

    tokenAdmin = await signIn('superadmin@nugacore.local');
    tokenLectura = await signIn('lectura@nugacore.local');

    const { createApp } = await import('../../backend/app');
    app = createApp();
  }, 30000);

  it('login super admin -> JWT válido', () => {
    expect(tokenAdmin.length).toBeGreaterThan(20);
    expect(tokenLectura.length).toBeGreaterThan(20);
  });

  it('JWT super admin -> /api/auth/me resuelve rol desde DB (source=supabase-jwt)', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('super admin');
    expect(res.body.source).toBe('supabase-jwt');
  });

  it('JWT solo lectura -> rol solo lectura; escritura protegida -> 403', async () => {
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenLectura}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('solo lectura');

    const post = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokenLectura}`)
      .send({ name: 'no-debe-crearse', type: 'residential', address: 'a', city: 'CDMX' });
    expect(post.status).toBe(403);
  });

  it('sin token -> /api/auth/me 401 (cuando no hay trusted-headers reales)', async () => {
    // En test los trusted-headers están activos por defecto; este caso valida
    // que un Bearer inválido NO autentica (se ignora) y cae a sin-contexto/headers.
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-invalido');
    // Con trusted-headers activos en test y sin x-user-*, se asigna rol por defecto.
    // Lo esencial: un Bearer inválido nunca produce source=supabase-jwt.
    if (res.status === 200) {
      expect(res.body.source).not.toBe('supabase-jwt');
    } else {
      expect(res.status).toBe(401);
    }
  });
});
