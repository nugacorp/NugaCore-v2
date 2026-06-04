import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.4 — Contrato del provisioning MikroTik (modo HERMÉTICO).
// RBAC, generación de script y dry-run de conexión. Sin red real.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const TEC = { 'x-user-role': 'tecnico', 'x-user-id': 'test-tec' };
const SOP = { 'x-user-role': 'soporte', 'x-user-id': 'test-sop' };
const COBR = { 'x-user-role': 'cobranza', 'x-user-id': 'test-cobr' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('MikroTik provisioning — RBAC de lectura', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('solo lectura puede listar routers (forma de provisioning)', async () => {
    const res = await request(app).get('/api/mikrotik/routers').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const r = res.body[0];
    for (const key of ['id', 'name', 'connectionType', 'status', 'hasCredentials', 'apiPort']) {
      expect(r).toHaveProperty(key);
    }
  });

  it('cobranza NO tiene acceso a MikroTik (403)', async () => {
    const res = await request(app).get('/api/mikrotik/routers').set(COBR);
    expect(res.status).toBe(403);
  });
});

describe('MikroTik provisioning — crear y generar script', () => {
  let app: Express;
  let routerId: string;
  beforeAll(() => { app = createApp(); });

  it('admin crea un router (status pending, sin credenciales)', async () => {
    const res = await request(app)
      .post('/api/mikrotik/routers')
      .set(ADMIN)
      .send({ name: 'Router Test 4.4', managementIp: '10.9.9.9', connectionType: 'wireguard' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.hasCredentials).toBe(false);
    routerId = res.body.id;
  });

  it('técnico genera el script (NugaCore, token, status provisioned)', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/provisioning-script`)
      .set(TEC)
      .send({ connectionType: 'wireguard' });
    expect(res.status).toBe(201);
    expect(res.body.script).toContain('NugaCore');
    expect(res.body.script.toLowerCase()).not.toContain('wisphub');
    expect(res.body.provisioningToken).toBeTruthy();
    expect(res.body.scriptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.router.status).toBe('provisioned');
    expect(res.body.credentials).toHaveProperty('apiUsername');
  });

  it('la respuesta NO expone passwords sueltos (solo dentro del script)', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/provisioning-script`)
      .set(TEC)
      .send({ connectionType: 'sstp' });
    expect(res.status).toBe(201);
    // credentials solo trae usernames, nunca password
    expect(res.body.credentials).not.toHaveProperty('password');
    expect(res.body.credentials).not.toHaveProperty('apiPassword');
    expect(res.body).not.toHaveProperty('password');
  });

  it('soporte NO puede generar script (403)', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/provisioning-script`)
      .set(SOP)
      .send({ connectionType: 'sstp' });
    expect(res.status).toBe(403);
  });
});

describe('MikroTik provisioning — rotación y test', () => {
  let app: Express;
  let routerId: string;
  beforeAll(async () => {
    app = createApp();
    const res = await request(app)
      .post('/api/mikrotik/routers')
      .set(ADMIN)
      .send({ name: 'Router Rotate 4.4', managementIp: '10.9.9.10', connectionType: 'sstp' });
    routerId = res.body.id;
  });

  it('rotar sin confirm → 400', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/rotate-credentials`)
      .set(ADMIN)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rotar con confirm → 201 y nuevo script', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/rotate-credentials`)
      .set(ADMIN)
      .send({ confirm: true, connectionType: 'sstp' });
    expect(res.status).toBe(201);
    expect(res.body.script).toContain('NugaCore');
    expect(res.body.provisioningToken).toBeTruthy();
  });

  it('técnico NO puede rotar credenciales (403)', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/rotate-credentials`)
      .set(TEC)
      .send({ confirm: true });
    expect(res.status).toBe(403);
  });

  it('test-connection es dry-run (sin red real)', async () => {
    const res = await request(app)
      .post(`/api/mikrotik/routers/${routerId}/test-connection`)
      .set(TEC)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.mode).toBe('dry-run');
    expect(Array.isArray(res.body.checks)).toBe(true);
  });
});
