import { describe, expect, it } from 'vitest';
import {
  belongsToTenant,
  dbErrorMessage,
  isMissingTenantIdColumnError,
  setTenantColumnReady,
  stripTenantIdIfUnsupported,
} from '../../backend/domains/tenancy/tenant-scope';

describe('tenant column resilience helpers', () => {
  it('detecta error PostgREST de columna tenant_id ausente', () => {
    expect(isMissingTenantIdColumnError({
      message: 'column tickets.tenant_id does not exist',
      code: '42703',
    })).toBe(true);
    expect(isMissingTenantIdColumnError(new Error('invoices list: boom'))).toBe(false);
  });

  it('extrae mensaje de errores no-Error (PostgREST)', () => {
    expect(dbErrorMessage({ message: 'column tickets.tenant_id does not exist' }))
      .toContain('tenant_id');
  });

  it('filtra legacy sin stamp como tenant-default', () => {
    expect(belongsToTenant(undefined, 'tenant-default')).toBe(true);
    expect(belongsToTenant(undefined, 'tenant-other')).toBe(false);
  });

  it('stripTenantIdIfUnsupported solo cuando la columna está marcada ausente', () => {
    setTenantColumnReady('tickets_test', false);
    const stripped = stripTenantIdIfUnsupported('tickets_test', { id: '1', tenant_id: 't' });
    expect(stripped).toEqual({ id: '1' });

    setTenantColumnReady('tickets_test_ok', true);
    const kept = stripTenantIdIfUnsupported('tickets_test_ok', { id: '1', tenant_id: 't' });
    expect(kept).toEqual({ id: '1', tenant_id: 't' });
  });
});
