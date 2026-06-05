import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.6.0 — Contrato: /provisioning-script acepta los 4 modos VPN.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

describe('Managed VPN provisioning — endpoint', () => {
  let app: Express;
  let routerId = '';
  beforeAll(async () => {
    app = createApp();
    const created = await request(app)
      .post('/api/mikrotik/routers')
      .set(ADMIN)
      .send({ name: 'VPN Modes Test', managementIp: '10.8.8.8', connectionType: 'wireguard' });
    routerId = created.body.id;
  });

  const gen = (mode: string) =>
    request(app).post(`/api/mikrotik/routers/${routerId}/provisioning-script`).set(ADMIN).send({ connectionType: mode });

  it('wireguard_managed → script WG, mode, routerVpnIp, apiUsername', async () => {
    const res = await gen('wireguard_managed');
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('wireguard_managed');
    expect(res.body.script).toContain('NugaCoreWG');
    expect(res.body.credentials.apiUsername).toBeTruthy();
    expect(res.body).toHaveProperty('routerVpnIp');
  });

  it('sstp_managed → script SSTP con vpnUsername', async () => {
    const res = await gen('sstp_managed');
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('sstp_managed');
    expect(res.body.script).toContain('NugaCoreVPN');
    expect(res.body.credentials).toHaveProperty('vpnUsername');
  });

  it('tailscale_lab → sin VPN, sin vpnUsername', async () => {
    const res = await gen('tailscale_lab');
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('tailscale_lab');
    expect(res.body.script).not.toContain('NugaCoreWG');
    expect(res.body.credentials).not.toHaveProperty('vpnUsername');
    expect(res.body.warnings.join(' ')).toMatch(/LABORATORIO/i);
  });

  it('direct_lab → válido', async () => {
    const res = await gen('direct_lab');
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('direct_lab');
  });

  it('modo inválido → 400', async () => {
    const res = await gen('zerotier_managed');
    expect(res.status).toBe(400);
  });

  it('la respuesta no expone passwords sueltos', async () => {
    const res = await gen('wireguard_managed');
    expect(res.body.credentials).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('password');
  });
});
