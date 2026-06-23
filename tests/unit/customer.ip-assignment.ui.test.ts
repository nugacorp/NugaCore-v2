import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canSubmitCustomerOnboarding,
  ipStatusMessage,
  type IpAssignmentValidation,
} from '../../src/lib/ipamView';

const crmSource = readFileSync('src/components/CrmModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

const requiredClientFields = {
  type: 'residential',
  address: 'Av. Reforma 101',
  city: 'CDMX',
};

const available: IpAssignmentValidation = {
  routerId: 'rb5009-main',
  poolId: 'pool-rb5009-main-100',
  ip: '192.168.100.25',
  status: 'available',
  available: true,
  message: 'IP disponible.',
};

const occupied: IpAssignmentValidation = {
  ...available,
  ip: '192.168.100.10',
  status: 'in_use',
  available: false,
  message: 'IP ya está en uso por otro cliente/equipo.',
};

describe('Alta de cliente — asignación IPAM UI', () => {
  it('muestra Router/Torre, pool, selector IP y botón de escaneo', () => {
    expect(crmSource).toContain('Asignación de Red');
    expect(crmSource).toContain('id="customer-router-id"');
    expect(crmSource).toContain('id="customer-pool-id"');
    expect(crmSource).toContain('id="customer-assigned-ip"');
    expect(crmSource).toContain('id="scan-available-ips-btn"');
    expect(crmSource).toContain('Escanear IPs disponibles');
  });

  it('integra autenticación real para consultar IPAM', () => {
    expect(crmSource).toContain('getAuthHeaders');
    expect(appSource).toContain('getAuthHeaders={getAuthHeaders}');
  });

  it('muestra advertencias claras para IP ocupada, fuera del pool e inválida', () => {
    expect(ipStatusMessage({ ...occupied, message: '' })).toContain('IP ya está en uso');
    expect(ipStatusMessage({ ...occupied, status: 'out_of_pool', message: '' })).toContain('IP fuera del segmento');
    expect(ipStatusMessage({ ...occupied, status: 'invalid', message: '' })).toContain('IP inválida');
    expect(crmSource).toContain('Selecciona router antes de asignar IP');
  });

  it('IP ocupada bloquea Confirmar Alta', () => {
    expect(canSubmitCustomerOnboarding({
      name: 'Cliente Activo',
      ...requiredClientFields,
      isLead: false,
      routerId: occupied.routerId,
      poolId: occupied.poolId,
      assignedIp: occupied.ip,
      validation: occupied,
    })).toBe(false);
  });

  it('IP válida permite Confirmar Alta para Cliente Activo', () => {
    expect(canSubmitCustomerOnboarding({
      name: 'Cliente Activo',
      ...requiredClientFields,
      isLead: false,
      routerId: available.routerId,
      poolId: available.poolId,
      assignedIp: available.ip,
      validation: available,
    })).toBe(true);
  });

  it('Cliente Activo requiere router, pool e IP validada', () => {
    expect(canSubmitCustomerOnboarding({
      name: 'Cliente sin red',
      ...requiredClientFields,
      isLead: false,
      routerId: '',
      poolId: '',
      assignedIp: '',
      validation: null,
    })).toBe(false);
  });

  it('Lead Comercial puede continuar sin IP', () => {
    expect(canSubmitCustomerOnboarding({
      name: 'Prospecto Comercial',
      ...requiredClientFields,
      isLead: true,
      routerId: '',
      poolId: '',
      assignedIp: '',
      validation: null,
    })).toBe(true);
  });

  it('bloquea submit si faltan campos requeridos por backend', () => {
    expect(canSubmitCustomerOnboarding({
      name: 'Cliente incompleto',
      type: 'residential',
      address: '',
      city: 'CDMX',
      isLead: true,
      routerId: '',
      poolId: '',
      assignedIp: '',
      validation: null,
    })).toBe(false);
    expect(crmSource).toContain('required');
  });

  it('el submit envía routerId, poolId, assignedIp e ipAssignmentStatus', () => {
    for (const field of ['routerId', 'poolId', 'assignedIp', 'ipAssignmentStatus']) {
      expect(crmSource).toContain(field);
    }
    expect(crmSource).toContain('disabled={!canConfirmAdd || ipamLoading}');
  });
});
