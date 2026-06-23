import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { clientActionCaps } from '../../src/lib/rbac';
import type { UserRole } from '../../src/lib/supabase';

// ====================================================================
// Client 360 + Acciones rápidas en la lista de clientes.
//
// Tests string-based (patrón del repo: lee el source y verifica contratos de
// UI/seguridad) + tests de la función pura de RBAC clientActionCaps.
// ====================================================================

const crmSource = readFileSync('src/components/CrmModule.tsx', 'utf8');
const menuSource = readFileSync('src/components/ClientActionsMenu.tsx', 'utf8');
const panelSource = readFileSync('src/components/Client360Panel.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('Client 360 — UI de acciones rápidas', () => {
  it('la tabla de clientes muestra una columna Acciones', () => {
    expect(crmSource).toContain('>Acciones</th>');
  });

  it('cada cliente tiene un botón de acciones (⋮)', () => {
    expect(crmSource).toContain('crm-actions-btn-${client.id}');
    expect(crmSource).toContain('aria-label="Acciones"');
    expect(crmSource).toContain('MoreVertical');
  });

  it('el menú agrupa Cliente / Servicio / Cobranza / Soporte / Red / Historial', () => {
    for (const group of ['Cliente', 'Servicio', 'Cobranza', 'Soporte', 'Red', 'Historial']) {
      expect(menuSource, `falta el grupo ${group}`).toContain(`title: '${group}'`);
    }
  });

  it('el menú incluye las acciones requeridas', () => {
    for (const label of [
      'Ver perfil', 'Editar cliente', 'Suspender servicio', 'Reactivar servicio',
      'Cambiar plan', 'Cambiar IP', 'Registrar pago', 'Generar factura',
      'Estado de cuenta', 'Crear ticket', 'Ver tickets', 'Ver router',
      'Ver ubicación', 'Copiar IP', 'Ver eventos',
    ]) {
      expect(menuSource, `falta la acción ${label}`).toContain(label);
    }
  });

  it('Ver perfil abre el panel Cliente 360', () => {
    expect(crmSource).toContain("case 'view-profile':");
    expect(crmSource).toContain('setClient360(client)');
    expect(crmSource).toContain('<Client360Panel');
    expect(panelSource).toContain('id="client-360-panel"');
    expect(panelSource).toContain('Cliente 360');
  });

  it('Cliente 360 muestra nombre, estado, plan, IP, router y dirección', () => {
    expect(panelSource).toContain('{client.name}');
    expect(panelSource).toContain('STATUS_LABEL');
    expect(panelSource).toContain('Plan');
    expect(panelSource).toContain('IP asignada');
    expect(panelSource).toContain('Router');
    expect(panelSource).toContain('Dirección');
  });

  it('Cliente 360 tiene empty state de historial', () => {
    expect(panelSource).toContain('No hay historial reciente para este cliente.');
  });

  it('Copiar IP da feedback (toast) y usa el portapapeles', () => {
    expect(crmSource).toContain('navigator.clipboard.writeText');
    expect(crmSource).toContain('IP copiada al portapapeles');
    expect(crmSource).toContain('client-action-toast');
  });

  it('Cliente sin GPS muestra "Cliente sin coordenadas."', () => {
    expect(crmSource).toContain('Cliente sin coordenadas.');
  });

  it('Cliente con GPS genera enlace a Google Maps', () => {
    expect(crmSource).toContain('https://www.google.com/maps?q=');
  });

  it('Suspender muestra simulación y NO ejecución real', () => {
    expect(crmSource).toContain('Esta acción todavía no ejecuta cambios reales');
    expect(crmSource).toContain('confirmSimulatedStatus');
    expect(crmSource).toContain('no se aplicó al router');
  });

  it('Generar factura muestra pendiente de integración', () => {
    expect(crmSource).toContain('Generación de factura pendiente de integración.');
  });

  it('App pasa userRole y onNavigate a CrmModule', () => {
    expect(appSource).toContain('userRole={userSession.role}');
    expect(appSource).toContain('onNavigate={setActiveTab}');
  });
});

describe('Client 360 — RBAC (clientActionCaps)', () => {
  const caps = (r: UserRole) => clientActionCaps(r);

  it('Super Admin ve todas las acciones', () => {
    const c = caps('Super Admin');
    expect(Object.values(c).every(Boolean)).toBe(true);
  });

  it('Administrador ve todas las acciones', () => {
    const c = caps('Administrador');
    expect(Object.values(c).every(Boolean)).toBe(true);
  });

  it('Cobranza NO ve Cambiar IP ni Suspender', () => {
    const c = caps('Cobranza');
    expect(c.changeIp).toBe(false);
    expect(c.suspend).toBe(false);
    expect(c.reactivate).toBe(false);
    // pero sí cobranza
    expect(c.registerPayment).toBe(true);
    expect(c.accountStatement).toBe(true);
  });

  it('Soporte NO ve Facturar ni Suspender', () => {
    const c = caps('Soporte');
    expect(c.generateInvoice).toBe(false);
    expect(c.suspend).toBe(false);
    // pero sí soporte
    expect(c.createTicket).toBe(true);
    expect(c.viewTickets).toBe(true);
  });

  it('Solo lectura NO ve acciones mutables', () => {
    const c = caps('Solo lectura');
    for (const key of ['suspend', 'reactivate', 'changePlan', 'changeIp', 'registerPayment', 'generateInvoice', 'editClient', 'createTicket'] as const) {
      expect(c[key], `Solo lectura no debería tener ${key}`).toBe(false);
    }
    // lectura segura
    expect(c.viewProfile).toBe(true);
    expect(c.viewHistory).toBe(true);
    expect(c.copyIp).toBe(true);
    expect(c.viewLocation).toBe(true);
  });

  it('Técnico ve acciones técnicas (router, IP, ticket, ubicación) pero no factura', () => {
    const c = caps('Técnico');
    expect(c.viewRouter).toBe(true);
    expect(c.changeIp).toBe(true);
    expect(c.createTicket).toBe(true);
    expect(c.viewLocation).toBe(true);
    expect(c.generateInvoice).toBe(false);
    expect(c.suspend).toBe(false);
  });

  it('rol desconocido → solo perfil/historial', () => {
    const c = clientActionCaps('NoExiste' as unknown as UserRole);
    expect(c.viewProfile).toBe(true);
    expect(c.viewHistory).toBe(true);
    expect(c.suspend).toBe(false);
    expect(c.registerPayment).toBe(false);
  });
});

describe('Client 360 — Seguridad', () => {
  const sources = [crmSource, menuSource, panelSource];

  it('no expone endpoints /execute', () => {
    for (const src of sources) expect(src).not.toContain('/execute');
  });

  it('no indica ejecución real sobre MikroTik/RouterOS', () => {
    for (const src of sources) {
      expect(src).not.toContain('MIKROTIK_WORKER_LIVE');
      expect(src).not.toContain('MIKROTIK_COMMIT_MODE');
      expect(src).not.toContain('MIKROTIK_WRITE_ENABLED');
      expect(src).not.toContain('USE_DB_MIKROTIK');
      expect(src).not.toContain('USE_DB_WIREGUARD');
    }
  });

  it('suspender/reactivar quick-action no llama RouterOS ni endpoints de routers', () => {
    // La simulación no debe disparar fetch a routeros / mikrotik / worker.
    expect(crmSource).not.toContain('/api/routeros');
    expect(crmSource).not.toContain('/api/mikrotik');
    expect(crmSource).not.toContain('worker');
  });
});
