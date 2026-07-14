// ====================================================================
// Tipos de la Biblioteca de Plantillas RouterOS (Fase 4.6.3).
// ====================================================================

export const TEMPLATE_LIBRARY_VERSION = 'nugacore-templates-1.0.3';

export type TemplateLibraryId =
  | 'router_base_wireguard'
  | 'router_base_sstp'
  | 'client_residential'
  | 'tower_wisp'
  | 'pcc_2wan'
  | 'pcc_3wan'
  | 'pcc_4wan'
  | 'pcc_5wan'
  | 'pppoe_server'
  | 'monitoring_agent'
  | 'wireguard_client'
  | 'wireguard_server'
  | 'noc_ready'
  | 'nugacore_factory_onboarding';

export const TEMPLATE_LIBRARY_IDS: TemplateLibraryId[] = [
  'router_base_wireguard',
  'router_base_sstp',
  'client_residential',
  'tower_wisp',
  'pcc_2wan',
  'pcc_3wan',
  'pcc_4wan',
  'pcc_5wan',
  'pppoe_server',
  'monitoring_agent',
  'wireguard_client',
  'wireguard_server',
  'noc_ready',
  'nugacore_factory_onboarding',
];

export type TemplateLibraryCategory =
  | 'core'
  | 'access'
  | 'tower'
  | 'balancer'
  | 'pppoe'
  | 'monitoring'
  | 'wireguard'
  | 'noc';

export interface TemplateLibraryDescriptor {
  id: TemplateLibraryId;
  name: string;
  description: string;
  category: TemplateLibraryCategory;
  routerosVersion: '6' | '7' | 'any';
  tags: string[];
  features: string[];
  generatorVersion: string;
}

export type TemplateApplyMode = 'factory_reset' | 'existing_config';

export const TEMPLATE_APPLY_MODES: TemplateApplyMode[] = ['factory_reset', 'existing_config'];

export interface TemplateLibraryParams {
  templateId: TemplateLibraryId;
  routerName: string;
  routerosVersion: '6' | '7';
  /**
   * Cómo aplicar el .rsc:
   * - factory_reset: wizard / onboarding — asume router limpio post-reset.
   * - existing_config: biblioteca — solo objetos NugaCore; no toca identity/DNS/drop WAN.
   */
  applyMode?: TemplateApplyMode;
  // LAN
  lanBridgeName?: string;
  lanCidr?: string;
  lanGateway?: string;
  wanInterface?: string;
  lanInterfaces?: string[];
  dhcpPoolStart?: string;
  dhcpPoolEnd?: string;
  dnsServers?: string[];
  enableNat?: boolean;
  enableBasicFirewall?: boolean;
  // WireGuard
  wgServerPublicKey?: string;
  wgEndpoint?: string;
  wgRouterIp?: string;
  wgManagementCidr?: string;
  wgVpnCidr?: string;
  wgKeepalive?: number;
  wgPrivateKey?: string;
  // SSTP
  sstpHost?: string;
  sstpUser?: string;
  sstpPassword?: string;
  sstpManagementCidr?: string;
  // PCC Balancer
  wanInterfaces?: string[];
  wanGateways?: string[];
  pccEnableFailover?: boolean;
  pccEnableWatchdog?: boolean;
  // PPPoE Server
  pppoeInterface?: string;
  pppoeServiceName?: string;
  pppoeLocalIp?: string;
  pppoeRemotePoolStart?: string;
  pppoeRemotePoolEnd?: string;
  // Tower
  vlanManagement?: number;
  vlanClients?: number;
  vlanBackhaul?: number;
  enableVlans?: boolean;
  // Monitoring
  enableWatchdog?: boolean;
  enableAutoBackup?: boolean;
  backupEmail?: string;
  watchdogTarget?: string;
  // NOC
  nocApiCidr?: string;
  enableApiSsl?: boolean;
  // API
  apiMode?: 'readonly' | 'operator';
  apiPort?: number;
  apiCidr?: string;
  enableDhcp?: boolean;
  // SNMP (factory onboarding)
  snmpCommunity?: string;
  snmpMgmtCidr?: string;
  zoneName?: string;
}

export interface TemplateGeneratedResource {
  script: string;
  scriptHash: string;
  filename: string;
  templateId: TemplateLibraryId;
  generatorVersion: string;
  warnings: string[];
  generatedAt: string;
  apiUsername?: string;
  snmpCommunity?: string;
}

export interface TemplateHistoryEntry {
  id: string;
  templateId: TemplateLibraryId;
  filename: string;
  scriptHash: string;
  generatedAt: string;
  generatedBy?: string;
  routerName: string;
  warnings: string[];
}

export interface TemplateGenerationRecord {
  id: string;
  templateId: TemplateLibraryId;
  routerName: string;
  filename: string;
  scriptHash: string;
  generatorVersion: string;
  warnings: string[];
  generatedAt: string;
  generatedBy?: string;
}
