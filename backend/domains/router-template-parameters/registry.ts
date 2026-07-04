// ====================================================================
// Dynamic Template Parameters Engine (Fase 4.9.2) — Registry.
//
// Declara el esquema de parámetros de cada plantilla soportada en el
// enrollment. Es la fuente de verdad del endpoint
//   GET /api/router-templates/:id/parameters
// y del formulario dinámico del Wizard.
//
// Solo se declaran plantillas con generador real en la RouterOS
// Templates Library (no se inventan generadores nuevos en esta fase).
// `wireguard_managed` queda cubierto por router_base_wireguard (WG
// gestionado por NugaCore; el usuario NO modifica wgPeer/wgKeys/wgServer).
// `hotspot_basic` se difiere: requiere un generador RouterOS nuevo.
// ====================================================================

import { TemplateParameterGroup, TemplateParameterSchema } from './types';
import {
  str,
  num,
  bool,
  ip,
  lanCidrParam,
  dhcpEnabledParam,
  dnsServersParam,
  wanGroups,
} from './schemas';

// ── Grupos comunes ──────────────────────────────────────────────────────

const lanGlobalGroup = (): TemplateParameterGroup => ({
  id: 'global',
  label: 'Configuración general',
  nested: false,
  parameters: [lanCidrParam(), dhcpEnabledParam(), dnsServersParam()],
});

const pccGlobalGroup = (): TemplateParameterGroup => ({
  id: 'global',
  label: 'Configuración general',
  nested: false,
  parameters: [
    bool('pbrEnabled', 'Habilitar PBR (Policy-Based Routing)', true, {
      description: 'Enrutamiento por conexión para balanceo PCC.',
    }),
    lanCidrParam(),
    dhcpEnabledParam(),
    dnsServersParam(),
  ],
});

// ── Ensamblado de plantillas PCC ────────────────────────────────────────

const pccSchema = (templateId: string, templateName: string, wanCount: number): TemplateParameterSchema => ({
  templateId,
  templateName,
  groups: [pccGlobalGroup(), ...wanGroups(wanCount)],
});

// ── Registry ────────────────────────────────────────────────────────────

export const TEMPLATE_PARAMETER_REGISTRY: Record<string, TemplateParameterSchema> = {
  router_base_wireguard: {
    templateId: 'router_base_wireguard',
    templateName: 'Router Base + WireGuard',
    groups: [lanGlobalGroup()],
    // WireGuard (peer, claves, servidor) lo gestiona NugaCore: NO es configurable.
  },

  tower_wisp: {
    templateId: 'tower_wisp',
    templateName: 'Torre WISP',
    groups: [
      {
        id: 'global',
        label: 'Configuración general',
        nested: false,
        parameters: [
          lanCidrParam(),
          dhcpEnabledParam(),
          dnsServersParam(),
          num('vlanManagement', 'VLAN Management', { defaultValue: 100 }),
          num('vlanClients', 'VLAN Clientes', { defaultValue: 200 }),
        ],
      },
    ],
  },

  pcc_2wan: pccSchema('pcc_2wan', 'Balanceador PCC — 2 WAN', 2),
  pcc_3wan: pccSchema('pcc_3wan', 'Balanceador PCC — 3 WAN', 3),
  pcc_4wan: pccSchema('pcc_4wan', 'Balanceador PCC — 4 WAN', 4),
  pcc_5wan: pccSchema('pcc_5wan', 'Balanceador PCC — 5 WAN', 5),

  pppoe_server: {
    templateId: 'pppoe_server',
    templateName: 'Servidor PPPoE',
    groups: [
      {
        id: 'global',
        label: 'Servidor PPPoE',
        nested: false,
        parameters: [
          str('pppoeInterface', 'Interfaz PPPoE', {
            required: true,
            defaultValue: 'bridge-lan',
            description: 'Interfaz donde escucha el servidor PPPoE.',
          }),
          ip('poolStart', 'Inicio del pool', { required: true, defaultValue: '10.100.0.2' }),
          ip('poolEnd', 'Fin del pool', { required: true, defaultValue: '10.100.0.254' }),
          ip('localAddress', 'Dirección local', { defaultValue: '10.100.0.1' }),
          dnsServersParam(),
        ],
      },
    ],
  },

  noc_ready: {
    templateId: 'noc_ready',
    templateName: 'NOC Ready',
    groups: [
      {
        id: 'global',
        label: 'Alertas y monitoreo',
        nested: false,
        parameters: [
          bool('telegramEnabled', 'Alertas por Telegram', false),
          bool('netwatchEnabled', 'Netwatch activo', true),
          bool('emailAlerts', 'Alertas por email', false),
        ],
      },
    ],
  },

  monitoring_agent: {
    templateId: 'monitoring_agent',
    templateName: 'Lab / CHR',
    groups: [
      {
        id: 'global',
        label: 'Monitoreo',
        nested: false,
        parameters: [
          ip('watchdogTarget', 'Host watchdog', { defaultValue: '8.8.8.8' }),
          bool('enableAutoBackup', 'Backups automáticos', true),
        ],
      },
    ],
  },
};

/** Devuelve el esquema de parámetros de una plantilla, o null si no existe. */
export function getParameterSchema(templateId: string): TemplateParameterSchema | null {
  return TEMPLATE_PARAMETER_REGISTRY[templateId] ?? null;
}

/** ¿La plantilla tiene esquema de parámetros declarado? */
export function hasParameterSchema(templateId: string): boolean {
  return templateId in TEMPLATE_PARAMETER_REGISTRY;
}

/** Lista plana de todos los parámetros de una plantilla (para validación/mapeo). */
export function flattenParameters(schema: TemplateParameterSchema) {
  return schema.groups.flatMap((g) =>
    g.parameters.map((p) => ({ group: g, parameter: p })),
  );
}
