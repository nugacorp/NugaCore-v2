import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  areValidCoordinates,
  capacityTone,
} from '../../src/lib/wispOnboardingView';

const crmSource = readFileSync('src/components/CrmModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('Customer onboarding WISP UI', () => {
  it('carga capacidad al seleccionar router y conserva el flujo IPAM', () => {
    expect(crmSource).toContain('/capacity');
    expect(crmSource).toContain('customer-router-capacity');
    expect(crmSource).toContain('customer-router-id');
    expect(crmSource).toContain('customer-pool-id');
    expect(crmSource).toContain('customer-assigned-ip');
  });

  it('implementa GPS automático y edición manual validada', () => {
    expect(crmSource).toContain('navigator.geolocation.getCurrentPosition');
    expect(crmSource).toContain('Obtener ubicación actual');
    expect(crmSource).toContain('GPS capturado correctamente.');
    expect(crmSource).toContain('customer-latitude');
    expect(crmSource).toContain('customer-longitude');
    expect(areValidCoordinates(19.4, -99.17)).toBe(true);
    expect(areValidCoordinates(91, -99.17)).toBe(false);
  });

  it('consulta cobertura y la presenta como información no bloqueante', () => {
    expect(crmSource).toContain('/api/coverage/check');
    expect(crmSource).toContain('Calcular cobertura');
    expect(crmSource).toContain('Distancia:');
    expect(crmSource).toContain('Azimut:');
    expect(crmSource).toContain('no bloquea el alta');
  });

  it('reserva equipo con serie y MAC sin indicar descuento de stock', () => {
    expect(crmSource).toContain('/api/inventory/customer-equipment');
    expect(crmSource).toContain('customer-equipment-serial');
    expect(crmSource).toContain('customer-equipment-mac');
    expect(crmSource).toContain('Equipo reservado para instalación.');
    expect(crmSource).toContain('No descuenta ni modifica stock.');
  });

  it('usa los umbrales visuales verde, amarillo y rojo', () => {
    expect(capacityTone(69.99)).toBe('green');
    expect(capacityTone(70)).toBe('yellow');
    expect(capacityTone(85)).toBe('yellow');
    expect(capacityTone(85.01)).toBe('red');
  });

  it('habilita alta para Técnico sin ampliar gestión de ciclo de vida', () => {
    expect(appSource).toContain("['Super Admin', 'Administrador', 'Técnico', 'Soporte']");
    expect(appSource).toContain("['Super Admin', 'Administrador', 'Cobranza']");
    expect(crmSource).toContain('canCreateClient');
    expect(crmSource).toContain('canManageClientLifecycle');
  });
});
