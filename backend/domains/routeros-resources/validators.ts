import { ResourceGeneratorParams } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const isValidCidr = (cidr: string): boolean =>
  /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr);

const isValidIp = (ip: string): boolean =>
  /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);

const isValidInterfaceName = (name: string): boolean =>
  /^[a-zA-Z0-9_\-\.]{1,64}$/.test(name);

export const validateParams = (p: Partial<ResourceGeneratorParams>): ValidationResult => {
  const errors: string[] = [];

  if (!p.templateId) errors.push('templateId es requerido');
  if (!p.routerName?.trim()) errors.push('routerName es requerido');
  if (p.routerName && p.routerName.length > 64) errors.push('routerName no puede superar 64 caracteres');

  if (!p.lanBridgeName?.trim()) errors.push('lanBridgeName es requerido');
  if (p.lanBridgeName && !isValidInterfaceName(p.lanBridgeName))
    errors.push('lanBridgeName contiene caracteres inválidos');

  if (!p.lanCidr) errors.push('lanCidr es requerido');
  else if (!isValidCidr(p.lanCidr)) errors.push('lanCidr no es un CIDR válido (ej: 192.168.88.0/24)');

  if (!p.lanGateway) errors.push('lanGateway es requerido');
  else if (!isValidIp(p.lanGateway)) errors.push('lanGateway no es una IP válida');

  if (!p.dhcpPoolStart) errors.push('dhcpPoolStart es requerido');
  else if (!isValidIp(p.dhcpPoolStart)) errors.push('dhcpPoolStart no es una IP válida');

  if (!p.dhcpPoolEnd) errors.push('dhcpPoolEnd es requerido');
  else if (!isValidIp(p.dhcpPoolEnd)) errors.push('dhcpPoolEnd no es una IP válida');

  if (!p.dnsServers || p.dnsServers.length === 0)
    errors.push('dnsServers debe contener al menos un servidor');
  else if (p.dnsServers.some((d) => !isValidIp(d)))
    errors.push('dnsServers contiene IPs inválidas');

  if (!p.wanInterface?.trim()) errors.push('wanInterface es requerido');
  if (p.wanInterface && !isValidInterfaceName(p.wanInterface))
    errors.push('wanInterface contiene caracteres inválidos');

  if (!p.lanInterfaces || p.lanInterfaces.length === 0)
    errors.push('lanInterfaces debe contener al menos una interfaz');
  if (p.lanInterfaces?.some((i) => !isValidInterfaceName(i)))
    errors.push('lanInterfaces contiene nombres de interfaz inválidos');

  if (!p.routerosVersion) errors.push('routerosVersion es requerida (6 o 7)');
  if (!p.apiMode) errors.push('apiMode es requerido (readonly u operator)');
  if (!p.apiPort || p.apiPort < 1 || p.apiPort > 65535)
    errors.push('apiPort debe ser un número entre 1 y 65535');

  if (p.templateId === 'base_wisp_wireguard') {
    if (!p.wgEndpoint?.trim()) errors.push('wgEndpoint es requerido para la plantilla WireGuard');
    if (!p.wgRouterIp?.trim()) errors.push('wgRouterIp es requerido para la plantilla WireGuard');
    if (!p.wgManagementCidr?.trim())
      errors.push('wgManagementCidr es requerido para la plantilla WireGuard');
    if (p.wgVpnCidr && !isValidCidr(p.wgVpnCidr))
      errors.push('wgVpnCidr no es un CIDR válido');
  }

  if (p.templateId === 'base_wisp_sstp') {
    if (!p.sstpHost?.trim()) errors.push('sstpHost es requerido para la plantilla SSTP');
    if (!p.sstpManagementCidr?.trim())
      errors.push('sstpManagementCidr es requerido para la plantilla SSTP');
  }

  return { valid: errors.length === 0, errors };
};
