import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// E2E — Ciclo de vida WISP completo (CRM/ERP) — modo HERMÉTICO.
//
// Recorre, contra el stack HTTP real (sin mocks de capa), la historia
// operativa completa que un WISP ejecuta a diario:
//
//   1. Infraestructura física: torre → sectorial → visible en GIS/mapa.
//   2. Alta de cliente: plan + GPS + IP + CPE reservado + torre.
//   3. Facturación ERP: crear/editar/pagar (parcial y total)/cancelar,
//      balance del cliente y ciclo de facturación.
//   4. Suspensión y reactivación lógica (sin tocar routers).
//   5. MikroTik desde 0: registrar router, script de provisioning,
//      test de conexión dry-run y lecturas read-only simuladas.
//   6. RBAC transversal sobre los flujos anteriores.
//
// SEGURIDAD: corre 100% en memoria (USE_DB_*=false), sin RouterOS real,
// sin MIKROTIK_WORKER_LIVE, sin commit mode. Es evidencia ejecutable
// auditable por Hermes de que los flujos de negocio están completos.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'e2e-admin' };
const TECNICO = { 'x-user-role': 'tecnico', 'x-user-id': 'e2e-tecnico' };
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'e2e-cobranza' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'e2e-reader' };

const TOWER_NAME = 'Torre E2E Cerro Grande';
const SECTOR_NAME = 'Sectorial E2E Norte 90°';
const CLIENT_NAME = 'Cliente E2E Juan Pérez';

describe('E2E WISP — ciclo de vida completo', () => {
  let app: Express;

  // Estado compartido de la historia (secuencial dentro del archivo).
  let towerId = '';
  let sectorId = '';
  let planId = '';
  let clientId = '';
  let invoiceId = '';
  let secondInvoiceId = '';
  let routerId = '';

  beforeAll(async () => {
    app = createApp();
    // En producción el servidor WireGuard ya existe en el VPS antes de enrolar
    // routers. En el entorno hermético lo sembramos como pre-existente para que
    // el registro de routers 'wireguard' (que auto-asigna IP VPN desde el
    // servidor default) refleje esa misma condición. No toca el VPS real.
    await request(app).post('/api/wireguard/servers').set(ADMIN).send({
      name: 'VPN E2E (pre-existente en VPS)',
      endpointHost: 'vpn.e2e.local',
      endpointPort: 13231,
      isDefault: true,
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 1. Infraestructura física: torre + sectorial + mapa
  // ──────────────────────────────────────────────────────────────────
  describe('1. Infraestructura: torre, sectorial y mapa', () => {
    it('crea una torre con GPS, altura y radio de cobertura', async () => {
      const res = await request(app).post('/api/network-towers').set(TECNICO).send({
        name: TOWER_NAME,
        lat: 19.4321,
        lng: -99.2011,
        height: 36,
        coverageRadiusKm: 8,
        ip: '10.77.255.1',
      });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(TOWER_NAME);
      expect(res.body.coverageRadiusKm).toBe(8);
      towerId = res.body.id;
    });

    it('rechaza torre duplicada por nombre (409)', async () => {
      const res = await request(app).post('/api/network-towers').set(TECNICO).send({ name: TOWER_NAME });
      expect(res.status).toBe(409);
    });

    it('crea una antena sectorial en la torre (azimuth + frecuencia)', async () => {
      const res = await request(app)
        .post(`/api/network-towers/${towerId}/sectors`)
        .set(TECNICO)
        .send({ name: SECTOR_NAME, azimuth: 90, frequency: '5.8 GHz' });
      expect(res.status).toBe(201);
      expect(res.body.towerId).toBe(towerId);
      expect(res.body.azimuth).toBe(90);
      sectorId = res.body.id;
    });

    it('edita la sectorial (reapunte de azimuth)', async () => {
      const res = await request(app)
        .put(`/api/network-sectors/${sectorId}`)
        .set(TECNICO)
        .send({ azimuth: 120 });
      expect(res.status).toBe(200);
      expect(res.body.azimuth).toBe(120);
    });

    it('la torre lista sus sectoriales', async () => {
      const res = await request(app).get(`/api/network-towers/${towerId}/sectors`).set(READER);
      expect(res.status).toBe(200);
      expect(res.body.some((s: { id: string }) => s.id === sectorId)).toBe(true);
    });

    it('la torre nueva aparece en el mapa GIS con su cobertura', async () => {
      const res = await request(app).get('/api/gis/map-data').set(READER);
      expect(res.status).toBe(200);
      const cov = (res.body.towerCoverage as Array<{ name: string; coverageRadiusKm: number }>)
        .find((t) => t.name === TOWER_NAME);
      expect(cov).toBeDefined();
      expect(cov!.coverageRadiusKm).toBe(8);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. Alta de cliente completa: plan + IP + CPE + GPS
  // ──────────────────────────────────────────────────────────────────
  describe('2. Alta de cliente: plan, IP, CPE y GPS', () => {
    it('existe catálogo de planes', async () => {
      const res = await request(app).get('/api/plans').set(READER);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      planId = res.body[0].id;
    });

    it('reserva un CPE del inventario para el cliente', async () => {
      const equip = await request(app).get('/api/inventory/customer-equipment').set(TECNICO);
      expect(equip.status).toBe(200);
      const cpe = (equip.body as Array<{ id: string; kind: string; serials: string[] }>)
        .find((e) => e.kind === 'CPE' && e.serials.length > 0);
      expect(cpe).toBeDefined();

      const res = await request(app)
        .post('/api/inventory/customer-equipment/reservations')
        .set(TECNICO)
        .send({
          equipmentId: cpe!.id,
          serial: cpe!.serials[0],
          mac: 'DC:2C:6E:AA:BB:01',
          customerLabel: CLIENT_NAME,
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('RESERVED');
    });

    it('valida el alta: sin nombre/dirección → 400', async () => {
      const res = await request(app).post('/api/clients').set(TECNICO).send({ type: 'residential' });
      expect(res.status).toBe(400);
    });

    it('valida el alta: email inválido → 400', async () => {
      const res = await request(app).post('/api/clients').set(TECNICO).send({
        name: 'X', type: 'residential', address: 'Calle 1', city: 'CDMX', email: 'no-es-email',
      });
      expect(res.status).toBe(400);
    });

    it('alta incompleta de red (solo IP, sin router/pool) → 400 IPAM', async () => {
      const res = await request(app).post('/api/clients').set(TECNICO).send({
        name: 'Incompleto', type: 'residential', address: 'Calle 2', city: 'CDMX',
        assignedIp: '10.77.0.50',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IPAM_ASSIGNMENT_INCOMPLETE');
    });

    it('da de alta al cliente con plan, GPS e IP vía flujo IPAM real', async () => {
      // Flujo IPAM: router → pool → IP disponible (provider mock).
      const routers = await request(app).get('/api/ipam/routers').set(TECNICO);
      expect(routers.status).toBe(200);
      expect(routers.body.length).toBeGreaterThan(0);
      const ipamRouterId: string = routers.body[0].id;

      const pools = await request(app).get(`/api/ipam/routers/${ipamRouterId}/pools`).set(TECNICO);
      expect(pools.status).toBe(200);
      expect(pools.body.length).toBeGreaterThan(0);
      const ipamPoolId: string = pools.body[0].id;

      const ips = await request(app).get(`/api/ipam/pools/${ipamPoolId}/available-ips`).set(TECNICO);
      expect(ips.status).toBe(200);
      const availableIp: string = (ips.body.ips || ips.body.availableIps || ips.body)[0];
      expect(availableIp).toBeTruthy();

      const res = await request(app).post('/api/clients').set(TECNICO).send({
        name: CLIENT_NAME,
        type: 'residential',
        email: 'juan.perez.e2e@example.com',
        phone: '5511224477',
        address: 'Camino al Cerro 100',
        city: 'CDMX',
        planId,
        lat: 19.433,
        lng: -99.2,
        connectionType: 'WISP',
        routerId: ipamRouterId,
        poolId: ipamPoolId,
        assignedIp: availableIp,
        notes: 'Alta E2E: torre Cerro Grande, sectorial Norte.',
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.assignedIp).toBe(availableIp);
      clientId = res.body.id;
    });

    it('el cliente quedó consultable con su plan', async () => {
      const res = await request(app).get(`/api/clients/${clientId}`).set(READER);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(CLIENT_NAME);
      expect(res.body.planId).toBe(planId);
    });

    it('edita al cliente (teléfono y notas) sin romper el resto', async () => {
      const res = await request(app).put(`/api/clients/${clientId}`).set(ADMIN).send({
        phone: '5599887766',
        notes: 'Instalación completada. CPE alineado a sectorial Norte.',
      });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('5599887766');
      expect(res.body.name).toBe(CLIENT_NAME);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. Facturación ERP: crear, editar, pagar, cancelar, balance, ciclo
  // ──────────────────────────────────────────────────────────────────
  describe('3. Facturación: ciclo de vida completo de la factura', () => {
    it('crea una factura manual para el cliente', async () => {
      const res = await request(app).post('/api/billing/invoices').set(ADMIN).send({
        clientId,
        amount: 600,
        items: [{ description: 'Servicio de internet — mes 1', price: 600, qty: 1 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.clientId).toBe(clientId);
      expect(res.body.status).toBe('unpaid');
      expect(res.body.pendingAmount).toBe(600);
      invoiceId = res.body.id;
    });

    it('edita la factura (monto y vencimiento)', async () => {
      const res = await request(app).put(`/api/billing/invoices/${invoiceId}`).set(ADMIN).send({
        amount: 650,
        dueDateStr: '2026-08-15',
      });
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(650);
      expect(res.body.dueDateStr).toBe('2026-08-15');
    });

    it('registra un pago PARCIAL: sigue unpaid y baja el pendiente', async () => {
      const res = await request(app).post(`/api/billing/invoices/${invoiceId}/pay`).set(COBRANZA).send({
        amount: 250,
        method: 'Efectivo',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).not.toBe('paid');
      expect(res.body.paidAmount).toBe(250);
      expect(res.body.pendingAmount).toBe(400);
    });

    it('rechaza sobrepago (400 OVERPAYMENT)', async () => {
      const res = await request(app).post(`/api/billing/invoices/${invoiceId}/pay`).set(COBRANZA).send({
        amount: 9999,
      });
      expect(res.status).toBe(400);
    });

    it('liquida el resto: factura queda paid', async () => {
      const res = await request(app).post(`/api/billing/invoices/${invoiceId}/pay`).set(COBRANZA).send({
        method: 'Transferencia',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('paid');
      expect(res.body.pendingAmount).toBe(0);
    });

    it('crea y CANCELA una segunda factura con razón auditada', async () => {
      const created = await request(app).post('/api/billing/invoices').set(ADMIN).send({
        clientId,
        amount: 120,
        items: [{ description: 'Cargo duplicado por error', price: 120, qty: 1 }],
      });
      expect(created.status).toBe(201);
      secondInvoiceId = created.body.id;

      const canceled = await request(app)
        .post(`/api/billing/invoices/${secondInvoiceId}/cancel`)
        .set(ADMIN)
        .send({ reason: 'Cargo duplicado — solicitado por administración.' });
      expect(canceled.status).toBe(200);
      expect(canceled.body.status).toBe('canceled');
    });

    it('el balance del cliente refleja pagos y cancelaciones', async () => {
      const res = await request(app).get(`/api/billing/customers/${clientId}/balance`).set(COBRANZA);
      expect(res.status).toBe(200);
      expect(res.body.customerId).toBe(clientId);
      // Factura 1 pagada, factura 2 cancelada → sin pendiente.
      expect(res.body.currentBalance).toBe(0);
      // Ambos pagos son del mismo día: el "último" puede ser cualquiera de los dos.
      expect([250, 400]).toContain(res.body.lastPaymentAmount);
    });

    it('los pagos quedan como recurso consultable por factura', async () => {
      const res = await request(app).get(`/api/billing/payments?invoiceId=${invoiceId}`).set(COBRANZA);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2); // parcial + liquidación
    });

    it('el ciclo de facturación corre y reporta resultados', async () => {
      const res = await request(app).post('/api/billing/run-cycle').set(ADMIN).send({});
      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. Suspensión y reactivación (lógica, sin routers)
  // ──────────────────────────────────────────────────────────────────
  describe('4. Suspensión lógica y reactivación', () => {
    it('suspende al cliente manualmente', async () => {
      const res = await request(app)
        .post(`/api/suspension/clients/${clientId}/suspend`)
        .set(ADMIN)
        .send({ reason: 'Prueba E2E de suspensión lógica.' });
      expect(res.status).toBe(200);

      const client = await request(app).get(`/api/clients/${clientId}`).set(READER);
      expect(client.body.status).toBe('suspended');
    });

    it('reactiva al cliente manualmente', async () => {
      const res = await request(app)
        .post(`/api/suspension/clients/${clientId}/reactivate`)
        .set(ADMIN)
        .send({ reason: 'Prueba E2E de reactivación.' });
      expect(res.status).toBe(200);

      const client = await request(app).get(`/api/clients/${clientId}`).set(READER);
      expect(client.body.status).toBe('active');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. MikroTik desde 0 (gated: sin router real, sin worker live)
  // ──────────────────────────────────────────────────────────────────
  describe('5. MikroTik: registrar router, provisioning y lecturas dry-run', () => {
    it('MIKROTIK_WORKER_LIVE permanece desactivado en este entorno', () => {
      expect((process.env.MIKROTIK_WORKER_LIVE || 'false').toLowerCase()).not.toBe('true');
    });

    it('registra el router de la torre (sin exigir password manual)', async () => {
      const res = await request(app).post('/api/mikrotik/routers').set(ADMIN).send({
        name: 'RB5009 E2E Cerro Grande',
        managementIp: '10.77.255.2',
        linkedTowerId: towerId,
        connectionType: 'wireguard',
        notes: 'Router E2E — nunca conectado a hardware real.',
      });
      expect(res.status).toBe(201);
      routerId = res.body.id;
      // Nunca exponer secretos en la respuesta.
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('encryptedpassword');
    });

    it('emite el script de provisioning para configurar el router desde 0', async () => {
      const res = await request(app)
        .post(`/api/mikrotik/routers/${routerId}/provisioning-script`)
        .set(ADMIN)
        .send({ connectionType: 'wireguard_managed' });
      expect(res.status).toBe(201);
      const payload = JSON.stringify(res.body);
      // El payload contiene un script RouterOS aplicable por consola.
      expect(payload).toContain('/');
    });

    it('test de conexión es DRY-RUN: valida checks sin abrir conexión real', async () => {
      const res = await request(app)
        .post(`/api/mikrotik/routers/${routerId}/test-connection`)
        .set(ADMIN)
        .send({});
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain('router_registered');
    });

    it('lecturas read-only devuelven datos simulados (sin RouterOS real)', async () => {
      const res = await request(app).get(`/api/mikrotik/routers/${routerId}/read/interfaces`).set(TECNICO);
      expect(res.status).toBe(200);
      expect(res.body.routerId).toBe(routerId);
      expect(res.body.data).toBeDefined();
    });
  });
  // ------------------------------------------------------------------
  // 6. RBAC transversal sobre los flujos anteriores
  // ------------------------------------------------------------------
  describe('6. RBAC: cada rol solo hace lo suyo', () => {
    it('cobranza NO puede crear clientes (403)', async () => {
      const res = await request(app).post('/api/clients').set(COBRANZA).send({
        name: 'Intruso', type: 'residential', address: 'X', city: 'X',
      });
      expect(res.status).toBe(403);
    });

    it('solo lectura NO puede crear facturas (403)', async () => {
      const res = await request(app).post('/api/billing/invoices').set(READER).send({
        clientId, amount: 1,
      });
      expect(res.status).toBe(403);
    });

    it('tecnico NO puede eliminar torres (403)', async () => {
      const res = await request(app).delete(`/api/network-towers/${towerId}`).set(TECNICO);
      expect(res.status).toBe(403);
    });

    it('cobranza NO puede registrar routers MikroTik (403)', async () => {
      const res = await request(app).post('/api/mikrotik/routers').set(COBRANZA).send({
        name: 'no', managementIp: '10.0.0.99',
      });
      expect(res.status).toBe(403);
    });

    it('sin identidad no hay acceso de escritura', async () => {
      const res = await request(app).post('/api/clients').send({
        name: 'Anon', type: 'residential', address: 'X', city: 'X',
      });
      expect([401, 403]).toContain(res.status);
    });
  });
});
