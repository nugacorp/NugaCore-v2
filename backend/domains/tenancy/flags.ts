/** Flag runtime: MULTI_TENANT_ENABLED=true activa aislamiento por tenant. */
export const isMultiTenantEnabled = (): boolean =>
  (process.env.MULTI_TENANT_ENABLED || 'false').trim().toLowerCase() === 'true';
