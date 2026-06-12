import { TemplateDescriptor, TemplateId } from './types';

export const TEMPLATES: TemplateDescriptor[] = [
  {
    id: 'base_wisp_wireguard',
    name: 'Router Base WISP + WireGuard NugaCore',
    description:
      'Configura LAN, DHCP, NAT, seguridad básica, usuario API NugaCore y túnel WireGuard hacia el servidor NugaCore. Recomendado para RouterOS v7.',
    category: 'production',
    rosVersionRequired: '7',
    features: ['LAN/DHCP', 'NAT', 'Firewall básico', 'WireGuard VPN', 'API NugaCore', 'Watchdog'],
  },
  {
    id: 'base_wisp_sstp',
    name: 'Router Base WISP + SSTP NugaCore',
    description:
      'Igual que la plantilla WireGuard pero usa SSTP. Recomendado para RouterOS v6 o redes que no soportan WireGuard.',
    category: 'production',
    rosVersionRequired: 'any',
    features: ['LAN/DHCP', 'NAT', 'Firewall básico', 'SSTP VPN', 'API NugaCore', 'Watchdog'],
  },
  {
    id: 'lab_direct',
    name: 'Laboratorio — Acceso Directo',
    description:
      'Configuración mínima sin VPN para pruebas internas en red local controlada. NO usar en producción.',
    category: 'lab',
    rosVersionRequired: 'any',
    features: ['LAN/DHCP', 'NAT', 'API NugaCore (LAN)'],
  },
];

export const getTemplate = (id: TemplateId): TemplateDescriptor | undefined =>
  TEMPLATES.find((t) => t.id === id);
