// ====================================================================
// Dynamic Template Parameters Engine (Fase 4.9.2) — Builders de esquema.
//
// Helpers reutilizables para declarar parámetros y grupos sin repetir
// boilerplate. registry.ts los ensambla por plantilla.
// ====================================================================

import {
  TemplateParameter,
  TemplateParameterGroup,
  TemplateParameterOption,
} from './types';

// ── Builders de parámetro ──────────────────────────────────────────────

export const str = (
  id: string,
  label: string,
  opts: Partial<TemplateParameter> = {},
): TemplateParameter => ({ id, label, type: 'string', required: false, ...opts });

export const num = (
  id: string,
  label: string,
  opts: Partial<TemplateParameter> = {},
): TemplateParameter => ({ id, label, type: 'number', required: false, ...opts });

export const bool = (
  id: string,
  label: string,
  defaultValue = false,
  opts: Partial<TemplateParameter> = {},
): TemplateParameter => ({ id, label, type: 'boolean', required: false, defaultValue, ...opts });

export const ip = (
  id: string,
  label: string,
  opts: Partial<TemplateParameter> = {},
): TemplateParameter => ({ id, label, type: 'ip', required: false, ...opts });

export const cidr = (
  id: string,
  label: string,
  opts: Partial<TemplateParameter> = {},
): TemplateParameter => ({ id, label, type: 'cidr', required: false, ...opts });

export const select = (
  id: string,
  label: string,
  options: TemplateParameterOption[],
  opts: Partial<TemplateParameter> = {},
): TemplateParameter => ({ id, label, type: 'select', required: false, options, ...opts });

// ── Parámetros comunes reutilizables ───────────────────────────────────

export const lanCidrParam = (): TemplateParameter =>
  cidr('lanCidr', 'CIDR LAN', {
    defaultValue: '192.168.88.1/24',
    description: 'Dirección de la red LAN en formato CIDR (IP/máscara).',
  });

export const dhcpEnabledParam = (): TemplateParameter =>
  bool('dhcpEnabled', 'Habilitar DHCP Server', true, {
    description: 'Entrega direcciones IP automáticamente en la LAN.',
  });

export const dnsServersParam = (): TemplateParameter =>
  str('dnsServers', 'Servidores DNS', {
    defaultValue: '8.8.8.8,1.1.1.1',
    description: 'Lista de DNS separados por coma.',
  });

// ── Grupo WAN (PCC) reutilizable ────────────────────────────────────────

const WAN_MODE_OPTIONS: TemplateParameterOption[] = [
  { label: 'DHCP', value: 'dhcp' },
  { label: 'Estática', value: 'static' },
  { label: 'PPPoE', value: 'pppoe' },
];

/** Construye el grupo de parámetros para una WAN (1-indexada) de PCC. */
export const wanGroup = (index: number): TemplateParameterGroup => ({
  id: `wan${index}`,
  label: `WAN ${index}`,
  nested: true,
  parameters: [
    select('mode', 'Modo de conexión', WAN_MODE_OPTIONS, {
      required: true,
      defaultValue: 'dhcp',
      description: 'Cómo obtiene IP la WAN: DHCP, estática o PPPoE.',
    }),
    str('interface', 'Interfaz física', {
      required: true,
      defaultValue: `ether${index}`,
      description: 'Puerto físico asignado a esta WAN.',
    }),
    ip('gateway', 'Gateway', {
      description: 'IP del gateway (requerido en modo estática).',
    }),
    num('bandwidthMbps', 'Ancho de banda (Mbps)', {
      defaultValue: 100,
      description: 'Velocidad de bajada estimada de la WAN.',
    }),
    ip('pingTarget', 'Ping target (failover)', {
      defaultValue: '8.8.8.8',
      description: 'Host para Netwatch / detección de caída.',
    }),
    str('username', 'Usuario PPPoE', {
      description: 'Solo en modo PPPoE.',
    }),
    str('password', 'Contraseña PPPoE', {
      secret: true,
      description: 'Solo en modo PPPoE. Nunca se muestra ni se registra.',
    }),
  ],
});

/** Construye los N grupos WAN para una plantilla PCC. */
export const wanGroups = (count: number): TemplateParameterGroup[] =>
  Array.from({ length: count }, (_, i) => wanGroup(i + 1));
