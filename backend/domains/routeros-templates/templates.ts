// ====================================================================
// Catálogo de plantillas RouterOS — Biblioteca NugaCore (Fase 4.6.3).
// 13 plantillas en 8 categorías.
// ====================================================================

import { TEMPLATE_LIBRARY_VERSION, TemplateLibraryDescriptor, TemplateLibraryId } from './types';

export const TEMPLATE_LIBRARY: TemplateLibraryDescriptor[] = [
  // ── CORE ──────────────────────────────────────────────────────────
  {
    id: 'nugacore_factory_onboarding',
    name: 'Factory Reset — WG + API + SNMP',
    description:
      'Onboarding post-factory-reset: identidad, LAN mínima, WireGuard, usuario API, SNMP (solo lectura) y firewall restringido a la VPN de gestión.',
    category: 'core',
    routerosVersion: '7',
    tags: ['factory-reset', 'wireguard', 'snmp', 'onboarding', 'produccion'],
    features: ['LAN mínima', 'WireGuard VPN', 'API NugaCore', 'SNMP read-only', 'Firewall VPN', 'Idempotente'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  {
    id: 'router_base_wireguard',
    name: 'Router Base WISP + WireGuard NugaCore',
    description:
      'Configura bridge LAN, DHCP, NAT, firewall básico, usuario API NugaCore y túnel WireGuard hacia el servidor NugaCore. Producción RouterOS v7.',
    category: 'core',
    routerosVersion: '7',
    tags: ['wisp', 'wireguard', 'vpn', 'produccion', 'base'],
    features: ['Bridge LAN', 'DHCP Server', 'NAT', 'Firewall básico', 'WireGuard VPN', 'API NugaCore', 'Watchdog', 'Idempotente'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  {
    id: 'router_base_sstp',
    name: 'Router Base WISP + SSTP NugaCore',
    description:
      'Igual que la plantilla WireGuard pero usa SSTP. Compatible con RouterOS v6 y v7 o redes que no soportan WireGuard.',
    category: 'core',
    routerosVersion: 'any',
    tags: ['wisp', 'sstp', 'vpn', 'produccion', 'base', 'v6'],
    features: ['Bridge LAN', 'DHCP Server', 'NAT', 'Firewall básico', 'SSTP VPN', 'API NugaCore', 'Watchdog', 'Idempotente'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── ACCESS ────────────────────────────────────────────────────────
  {
    id: 'client_residential',
    name: 'Router Residencial',
    description:
      'Router para cliente residencial WISP. Bridge, DHCP, NAT, firewall básico. WireGuard opcional para gestión remota NugaCore.',
    category: 'access',
    routerosVersion: 'any',
    tags: ['residencial', 'cliente', 'access', 'wisp', 'cpe'],
    features: ['Bridge', 'DHCP Server', 'NAT', 'Firewall básico', 'WireGuard opcional'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── TOWER ─────────────────────────────────────────────────────────
  {
    id: 'tower_wisp',
    name: 'Torre WISP (RB5009 / CCR)',
    description:
      'Configuración completa para torre WISP sobre RB5009 o CCR. Bridge, VLANs, management VLAN, WireGuard, monitoreo, scheduler y backups automáticos.',
    category: 'tower',
    routerosVersion: '7',
    tags: ['torre', 'rb5009', 'ccr', 'wisp', 'vlan', 'gestion', 'noc'],
    features: ['Bridge principal', 'VLANs', 'Management VLAN', 'WireGuard NugaCore', 'Monitoreo', 'Scheduler', 'Backups automáticos'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── BALANCER ──────────────────────────────────────────────────────
  {
    id: 'pcc_2wan',
    name: 'Balanceo PCC — 2 WAN',
    description:
      'Balance de carga PCC profesional para 2 conexiones WAN con failover automático, Netwatch, route distance y watchdog. Implementación propia NugaCore.',
    category: 'balancer',
    routerosVersion: 'any',
    tags: ['pcc', 'balanceo', '2wan', 'failover', 'load-balance', 'netwatch'],
    features: ['PCC 2 WAN', 'Failover automático', 'Netwatch', 'Route distance', 'Watchdog', 'Logs'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  {
    id: 'pcc_3wan',
    name: 'Balanceo PCC — 3 WAN',
    description:
      'Balance de carga PCC profesional para 3 conexiones WAN con failover automático, Netwatch, route distance y watchdog. Implementación propia NugaCore.',
    category: 'balancer',
    routerosVersion: 'any',
    tags: ['pcc', 'balanceo', '3wan', 'failover', 'load-balance', 'netwatch'],
    features: ['PCC 3 WAN', 'Failover automático', 'Netwatch', 'Route distance', 'Watchdog', 'Logs'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  {
    id: 'pcc_4wan',
    name: 'Balanceo PCC — 4 WAN',
    description:
      'Balance de carga PCC profesional para 4 conexiones WAN con failover automático, Netwatch, route distance y watchdog. Implementación propia NugaCore.',
    category: 'balancer',
    routerosVersion: 'any',
    tags: ['pcc', 'balanceo', '4wan', 'failover', 'load-balance', 'netwatch'],
    features: ['PCC 4 WAN', 'Failover automático', 'Netwatch', 'Route distance', 'Watchdog', 'Logs'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  {
    id: 'pcc_5wan',
    name: 'Balanceo PCC — 5 WAN',
    description:
      'Balance de carga PCC profesional para 5 conexiones WAN con failover automático, Netwatch, route distance y watchdog. Implementación propia NugaCore.',
    category: 'balancer',
    routerosVersion: 'any',
    tags: ['pcc', 'balanceo', '5wan', 'failover', 'load-balance', 'netwatch'],
    features: ['PCC 5 WAN', 'Failover automático', 'Netwatch', 'Route distance', 'Watchdog', 'Logs'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── PPPOE ─────────────────────────────────────────────────────────
  {
    id: 'pppoe_server',
    name: 'Servidor PPPoE',
    description:
      'Servidor PPPoE completo con pools de IPs, perfiles de velocidad, secrets de ejemplo y queues simples. Listo para ISP.',
    category: 'pppoe',
    routerosVersion: 'any',
    tags: ['pppoe', 'servidor', 'isp', 'pool', 'queues', 'perfiles'],
    features: ['PPPoE Server', 'IP Pools', 'Perfiles de velocidad', 'Secrets de ejemplo', 'Queues simples'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── MONITORING ────────────────────────────────────────────────────
  {
    id: 'monitoring_agent',
    name: 'Agente de Monitoreo',
    description:
      'Configura scheduler, watchdog, backups automáticos, logging y métricas del sistema. Para routers ya configurados.',
    category: 'monitoring',
    routerosVersion: 'any',
    tags: ['monitoreo', 'scheduler', 'watchdog', 'backup', 'logs', 'metricas'],
    features: ['Scheduler', 'Watchdog de conectividad', 'Backups automáticos', 'Logs', 'Métricas del sistema'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── WIREGUARD ─────────────────────────────────────────────────────
  {
    id: 'wireguard_client',
    name: 'WireGuard — Cliente',
    description:
      'Configura el router como cliente WireGuard. Integrado con WireGuard Manager de NugaCore para configuración automática de peers.',
    category: 'wireguard',
    routerosVersion: '7',
    tags: ['wireguard', 'cliente', 'vpn', 'manager', 'peer'],
    features: ['Interfaz WireGuard', 'Peer config', 'Keepalive', 'Routing VPN', 'Integración WG Manager'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  {
    id: 'wireguard_server',
    name: 'WireGuard — Servidor',
    description:
      'Configura el router como servidor WireGuard. Firewall, NAT y routing para la red VPN. Integrado con WireGuard Manager de NugaCore.',
    category: 'wireguard',
    routerosVersion: '7',
    tags: ['wireguard', 'servidor', 'vpn', 'manager', 'concentrador'],
    features: ['Servidor WireGuard', 'Firewall WG', 'NAT VPN', 'Routing peers', 'Integración WG Manager'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
  // ── NOC ───────────────────────────────────────────────────────────
  {
    id: 'noc_ready',
    name: 'NOC Ready',
    description:
      'Prepara el router para operaciones NOC: API segura con permisos mínimos, usuario nugacore, logging estructurado, watchdog y auditoría.',
    category: 'noc',
    routerosVersion: 'any',
    tags: ['noc', 'api', 'seguridad', 'logging', 'auditoria', 'gestion'],
    features: ['API segura', 'Usuario nugacore', 'Permisos mínimos', 'Logging', 'Watchdog', 'Auditoría'],
    generatorVersion: TEMPLATE_LIBRARY_VERSION,
  },
];

export const getTemplateById = (id: TemplateLibraryId): TemplateLibraryDescriptor | undefined =>
  TEMPLATE_LIBRARY.find((t) => t.id === id);

export const getTemplatesByCategory = (
  category: TemplateLibraryDescriptor['category'],
): TemplateLibraryDescriptor[] => TEMPLATE_LIBRARY.filter((t) => t.category === category);
