// ====================================================================
// Tipos del generador de recursos RouterOS (Fase 4.6.2).
// ====================================================================

export const RESOURCE_GENERATOR_VERSION = 'nugacore-rscgen-1.0';

export type TemplateId = 'base_wisp_wireguard' | 'base_wisp_sstp' | 'lab_direct';

export type TemplateCategory = 'production' | 'lab';

export type ApiMode = 'readonly' | 'operator';

export interface TemplateDescriptor {
  id: TemplateId;
  name: string;
  description: string;
  category: TemplateCategory;
  rosVersionRequired: '6' | '7' | 'any';
  features: string[];
}

export interface ResourceGeneratorParams {
  templateId: TemplateId;
  routerName: string;
  lanBridgeName: string;
  lanCidr: string;
  lanGateway: string;
  dhcpPoolStart: string;
  dhcpPoolEnd: string;
  dnsServers: string[];
  wanInterface: string;
  lanInterfaces: string[];
  enableNat: boolean;
  enableBasicFirewall: boolean;
  enableDhcpServer: boolean;
  routerosVersion: '6' | '7';
  apiMode: ApiMode;
  apiPort: number;
  // WireGuard — requerido si templateId === 'base_wisp_wireguard'
  wgServerPublicKey?: string;
  wgEndpoint?: string;
  wgRouterIp?: string;
  wgManagementCidr?: string;
  wgVpnCidr?: string;
  wgKeepalive?: number;
  // SSTP — requerido si templateId === 'base_wisp_sstp'
  sstpHost?: string;
  sstpVpnCidr?: string;
  sstpManagementCidr?: string;
}

export interface GeneratedResource {
  script: string;
  scriptHash: string;
  filename: string;
  templateId: TemplateId;
  generatorVersion: string;
  warnings: string[];
  generatedAt: string;
  apiUsername: string;
}

export interface ResourceHistoryEntry {
  id: string;
  templateId: TemplateId;
  filename: string;
  scriptHash: string;
  generatedAt: string;
  generatedBy: string;
  routerName: string;
}

// Solo metadatos para persistir — nunca el script completo ni passwords en claro.
export interface ResourceGenerationRecord {
  id: string;
  templateId: TemplateId;
  routerName: string;
  filename: string;
  scriptHash: string;
  generatorVersion: string;
  warnings: string[];
  generatedAt: string;
  generatedBy?: string;
}
