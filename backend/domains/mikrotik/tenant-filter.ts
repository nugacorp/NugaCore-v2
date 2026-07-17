import type { MikrotikRouterRegistryItem } from '../../state/store';
import { DEFAULT_TENANT_ID } from '../tenancy/types';

/** Tenant efectivo de un router (filas legacy sin stamp → tenant-default). */
export const resolveRouterTenantId = (router: MikrotikRouterRegistryItem): string =>
  router.tenantId || DEFAULT_TENANT_ID;

export const filterRoutersByTenant = (
  routers: readonly MikrotikRouterRegistryItem[],
  tenantId: string,
): MikrotikRouterRegistryItem[] =>
  routers.filter((router) => resolveRouterTenantId(router) === tenantId);

export const findRouterForTenant = (
  routers: readonly MikrotikRouterRegistryItem[],
  id: string,
  tenantId: string,
): MikrotikRouterRegistryItem | undefined =>
  routers.find((router) => router.id === id && resolveRouterTenantId(router) === tenantId);
