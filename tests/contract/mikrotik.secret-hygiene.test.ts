import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { provisioningStore } from '../../backend/domains/mikrotik/provisioning/store';

// ====================================================================
// Fase 4.4.1 — Higiene de secretos del provisioning MikroTik.
// Garantiza que passwords/tokens/scripts NO aparezcan en logs, en la
// auditoría ni en respuestas posteriores. Sin red real.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

const passwordsInScript = (script: string): string[] =>
  [...script.matchAll(/password="([^"]+)"/g)].map((m) => m[1]);

describe('MikroTik secret hygiene', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('no imprime passwords/token/script en consola al generar script', async () => {
    const captured: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );

    let res;
    try {
      const created = await request(app)
        .post('/api/mikrotik/routers')
        .set(ADMIN)
        .send({ name: 'Hygiene R1', managementIp: '10.7.7.7', connectionType: 'sstp' });
      res = await request(app)
        .post(`/api/mikrotik/routers/${created.body.id}/provisioning-script`)
        .set(ADMIN)
        .send({ connectionType: 'sstp' });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }

    expect(res!.status).toBe(201);
    const script = res!.body.script as string;
    const token = res!.body.provisioningToken as string;
    const pws = passwordsInScript(script);
    expect(pws.length).toBeGreaterThan(0);

    const logBlob = captured.join('\n');
    for (const pw of pws) expect(logBlob, 'password en logs').not.toContain(pw);
    expect(logBlob, 'token en logs').not.toContain(token);
    // El script completo nunca se loguea (la línea de alta de usuario no aparece).
    expect(logBlob).not.toMatch(/\/user add name="nugacore_/);

    // La respuesta no expone passwords sueltos.
    expect(res!.body.credentials).not.toHaveProperty('password');
    expect(res!.body.credentials).not.toHaveProperty('apiPassword');
  });

  it('GET router no devuelve secretos tras el provisioning', async () => {
    const created = await request(app)
      .post('/api/mikrotik/routers')
      .set(ADMIN)
      .send({ name: 'Hygiene R2', managementIp: '10.7.7.8', connectionType: 'wireguard' });
    const id = created.body.id;
    const prov = await request(app)
      .post(`/api/mikrotik/routers/${id}/provisioning-script`)
      .set(ADMIN)
      .send({ connectionType: 'wireguard' });
    const token = prov.body.provisioningToken as string;
    const pws = passwordsInScript(prov.body.script);

    const got = await request(app).get(`/api/mikrotik/routers/${id}`).set(ADMIN);
    expect(got.status).toBe(200);
    expect(got.body).not.toHaveProperty('encryptedPassword');
    expect(got.body).not.toHaveProperty('plainPassword');
    expect(got.body).not.toHaveProperty('provisioningToken');
    expect(got.body.hasCredentials).toBe(true);

    const blob = JSON.stringify(got.body);
    expect(blob).not.toContain(token);
    for (const pw of pws) expect(blob).not.toContain(pw);
  });

  it('la auditoría de provisioning no contiene secretos', async () => {
    const created = await request(app)
      .post('/api/mikrotik/routers')
      .set(ADMIN)
      .send({ name: 'Hygiene R3', managementIp: '10.7.7.9', connectionType: 'sstp' });
    const id = created.body.id;
    const prov = await request(app)
      .post(`/api/mikrotik/routers/${id}/provisioning-script`)
      .set(ADMIN)
      .send({ connectionType: 'sstp' });
    const token = prov.body.provisioningToken as string;
    const pws = passwordsInScript(prov.body.script);

    const auditBlob = JSON.stringify(provisioningStore.AUDIT);
    expect(auditBlob).not.toContain(token);
    for (const pw of pws) expect(auditBlob).not.toContain(pw);
    // Tampoco se persiste el script completo en la auditoría.
    expect(auditBlob).not.toMatch(/\/user add name="nugacore_/);
  });
});
