// ====================================================================
// Nombres cortos de archivo .rsc para import fácil en Terminal CHR/Winbox.
//
// Antes : nugacore-tpl-router-base-wireguard-CHR--CHR-2026-07-15.rsc
// Ahora : nc-wg-chr.rsc
// ====================================================================

/** Abreviaturas estables por plantilla (fácil de teclear en RouterOS). */
export const TEMPLATE_FILENAME_ABBR: Record<string, string> = {
  router_base_wireguard: 'wg',
  nugacore_factory_onboarding: 'fact',
  router_base_sstp: 'sstp',
  tower_wisp: 'tower',
  client_residential: 'cli',
  pcc_2wan: 'pcc2',
  pcc_3wan: 'pcc3',
  pcc_4wan: 'pcc4',
  pcc_5wan: 'pcc5',
  pppoe_server: 'pppoe',
  monitoring_agent: 'mon',
  wireguard_client: 'wgc',
  wireguard_server: 'wgs',
  noc_ready: 'noc',
};

/** Prefijo corto de todos los .rsc NugaCore (nuevo formato). */
export const RSC_FILE_PREFIX = 'nc-';

/** Patrón RouterOS para borrar .rsc nuevos y legacy tras /import. */
export const RSC_FILE_CLEANUP_FIND =
  'name~"^(nc-|nugacore-tpl-|nugacore-)"';

/**
 * Slug corto del router: minúsculas, solo [a-z0-9], sin dobles guiones.
 * "CHR -CHR" → "chrchr"  |  "Torre Norte #2" → "torrenorte2"
 */
export function buildShortRouterSlug(routerName: string, maxLen = 12): string {
  const slug = routerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .substring(0, maxLen);
  return slug || 'rtr';
}

export function templateFilenameAbbr(templateId: string): string {
  return TEMPLATE_FILENAME_ABBR[templateId] || templateId.replace(/_/g, '').substring(0, 6) || 'tpl';
}

/**
 * Nombre corto para descarga /import:
 *   nc-{abbr}-{slug}.rsc   →   nc-wg-chr.rsc
 */
export function buildTemplateFilename(routerName: string, templateId: string): string {
  const abbr = templateFilenameAbbr(templateId);
  const slug = buildShortRouterSlug(routerName);
  return `${RSC_FILE_PREFIX}${abbr}-${slug}.rsc`;
}
