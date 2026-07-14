// ====================================================================
// Template Mapper — Router Enrollment (Fase 4.9.1).
//
// Responsabilidad: traducir el templateId del wizard al generador
// correcto de la RouterOS Templates Library, construir los parámetros
// adecuados por tipo de plantilla y determinar si WireGuard debe
// incrustarse en el script.
//
// NO duplica lógica de generator.ts. Solo orquesta parámetros.
// ====================================================================

import { BadRequestError } from '../../common/errors';
import { getTemplateById } from '../routeros-templates/templates';
import { TEMPLATE_LIBRARY_VERSION } from '../routeros-templates/types';
import type { TemplateLibraryId, TemplateLibraryParams } from '../routeros-templates/types';
import type { PeerCreatedOnce } from '../wireguard/types';
import type { StartEnrollmentInput } from './types';

// ── Templates soportados en enrollment ────────────────────────────────

/**
 * Subconjunto de TemplateLibraryId disponible en el Wizard.
 * Fase 4.9.2 puede agregar más.
 */
export const ENROLLMENT_SUPPORTED_TEMPLATES = new Set<string>([
  'nugacore_factory_onboarding',
  'router_base_wireguard',
  'tower_wisp',
  'pcc_2wan',
  'pcc_3wan',
  'pcc_4wan',
  'pcc_5wan',
  'pppoe_server',
  'noc_ready',
  'monitoring_agent',
]);

// Templates cuyo script incrusta credenciales WireGuard de NugaCore.
// Los demás (PCC, PPPoE, NOC, monitoring) no necesitan WG en el script.
const WG_TEMPLATES = new Set<string>([
  'nugacore_factory_onboarding',
  'router_base_wireguard',
  'tower_wisp',
]);

/**
 * ¿El SCRIPT de esta plantilla incrusta credenciales WireGuard? Solo estas
 * plantillas requieren datos del peer WG para regenerarse en /download. Las
 * demás (pcc_*, pppoe_server, noc_ready, monitoring_agent) NO dependen de
 * WireGuard para el script, por lo que download no debe consultar el WG store.
 */
export function enrollmentTemplateNeedsWireguard(templateId: string | undefined | null): boolean {
  const id = (templateId || '').trim() || 'router_base_wireguard';
  return WG_TEMPLATES.has(id);
}

// ── Resultado del mapper ──────────────────────────────────────────────

export interface ResolvedTemplateResult {
  /** ID real en la biblioteca (mismo valor que el wizard en esta fase). */
  libraryId: TemplateLibraryId;
  /** Nombre legible de la plantilla (para la respuesta de la API). */
  templateName: string;
  /** Versión del generador (para la respuesta de la API). */
  generatorVersion: string;
  /** ¿Incrusta credenciales WireGuard NugaCore en el script? */
  needsWireGuard: boolean;
  /** Parámetros listos para pasar a generateFromTemplate(). */
  params: TemplateLibraryParams;
}

// ── Validación ───────────────────────────────────────────────────────

/**
 * Lanza HTTP 400 TEMPLATE_NOT_FOUND si el templateId no es reconocido.
 */
export function validateEnrollmentTemplateId(templateId: string | undefined | null): void {
  if (!templateId || !ENROLLMENT_SUPPORTED_TEMPLATES.has(templateId)) {
    const known = [...ENROLLMENT_SUPPORTED_TEMPLATES].join(', ');
    throw new BadRequestError(
      `templateId '${templateId ?? ''}' no válido para enrollment. ` +
        `Templates soportados: ${known}.`,
      'TEMPLATE_NOT_FOUND',
    );
  }
}

// ── Metadata derivada (no persistida) ─────────────────────────────────

export interface TemplateMetadata {
  templateName: string;
  generatorVersion: string;
}

/**
 * Deriva templateName y generatorVersion desde el templateId.
 * No persiste información duplicada: se calcula desde la biblioteca al vuelo.
 * Si el templateId no existe en la biblioteca, devuelve el id como nombre.
 */
export function getTemplateMetadata(templateId: string): TemplateMetadata {
  const descriptor = getTemplateById(templateId as TemplateLibraryId);
  return {
    templateName:     descriptor?.name ?? templateId,
    generatorVersion: descriptor?.generatorVersion ?? TEMPLATE_LIBRARY_VERSION,
  };
}

// ── Mapper principal ──────────────────────────────────────────────────

/**
 * Construye los parámetros correctos para generateFromTemplate() según
 * el templateId del wizard y los datos disponibles del enrollment.
 *
 * Para PCC: los wanInterfaces del modo avanzado se persisten en el payload
 * del wizard pero el mapper los ignora en esta fase (Fase 4.9.2 los usará).
 */
export function resolveTemplateParams(
  templateId: string,
  input: StartEnrollmentInput,
  peerConfig: PeerCreatedOnce | null,
): ResolvedTemplateResult {
  validateEnrollmentTemplateId(templateId);

  const libId = templateId as TemplateLibraryId;
  const descriptor = getTemplateById(libId);

  // getTemplateById solo falla si ENROLLMENT_SUPPORTED_TEMPLATES está
  // desincronizado con TEMPLATE_LIBRARY — nunca debería ocurrir.
  if (!descriptor) {
    throw new BadRequestError(
      `Template '${templateId}' no encontrado en la biblioteca. Verifica la configuración.`,
      'TEMPLATE_NOT_FOUND',
    );
  }

  const needsWireGuard = WG_TEMPLATES.has(templateId);

  const lanInterfaces = Array.isArray(input.lanInterfaces)
    ? input.lanInterfaces.map((s) => s.trim()).filter(Boolean)
    : typeof input.lanInterfaces === 'string'
      ? input.lanInterfaces.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

  // ── Parámetros base comunes a todas las plantillas ─────────────────
  const baseParams: TemplateLibraryParams = {
    templateId: libId,
    routerName: input.routerName,
    routerosVersion: input.routerosVersion,
    lanBridgeName: input.lanBridgeName,
    lanCidr:        input.lanCidr,
    lanGateway:     input.lanGateway,
    wanInterface:   input.wanInterface,
    lanInterfaces,
    dhcpPoolStart: input.dhcpPoolStart,
    dhcpPoolEnd: input.dhcpPoolEnd,
    enableDhcp: input.enableDhcp,
  };

  // ── Parámetros WireGuard (solo si la plantilla los incrusta) ───────
  // peerConfig puede ser null para plantillas no-WG (download no consulta el
  // WG store en ese caso). El guard evita acceder a un peerConfig ausente.
  const wgParams = needsWireGuard && peerConfig
    ? {
        wgServerPublicKey: peerConfig.serverPublicKey,
        wgEndpoint:        peerConfig.serverEndpoint,
        wgRouterIp:        peerConfig.assignedIp,
        wgManagementCidr:  peerConfig.allowedCidr,
        wgVpnCidr:         peerConfig.allowedCidr,
        wgPrivateKey:      peerConfig.privateKey,
        wgKeepalive:       25,
        snmpMgmtCidr:      peerConfig.allowedCidr,
        zoneName:          input.routerName,
      }
    : {};

  // ── Parámetros PCC (básicos; avanzados en Fase 4.9.2) ─────────────
  // En modo básico solo tenemos wanInterface (singular) del wizard.
  // El generador padea los WANs faltantes con ether1...etherN y avisa.
  const pccParams = templateId.startsWith('pcc_')
    ? {
        wanInterfaces:    input.wanInterface ? [input.wanInterface] : undefined,
        pccEnableFailover: true,
        pccEnableWatchdog: true,
      }
    : {};

  return {
    libraryId:        libId,
    templateName:     descriptor.name,
    generatorVersion: descriptor.generatorVersion ?? TEMPLATE_LIBRARY_VERSION,
    needsWireGuard,
    params:           { ...baseParams, ...wgParams, ...pccParams },
  };
}
