import { describe, it, expect } from 'vitest';
import { computeAllowTrustedHeaders } from '../../backend/common/auth-context';

// Propiedad de seguridad central de Fase 2:
// en PRODUCCIÓN los trusted-headers están SIEMPRE deshabilitados (JWT-only),
// sin importar AUTH_TRUST_HEADERS. En dev son una conveniencia opt-in.
describe('computeAllowTrustedHeaders', () => {
  it('producción: SIEMPRE false (aunque AUTH_TRUST_HEADERS=true y sin Supabase)', () => {
    expect(computeAllowTrustedHeaders(true, true, true)).toBe(false);
    expect(computeAllowTrustedHeaders(true, true, false)).toBe(false);
    expect(computeAllowTrustedHeaders(true, false, false)).toBe(false);
  });

  it('dev + AUTH_TRUST_HEADERS=true: permitido', () => {
    expect(computeAllowTrustedHeaders(false, true, true)).toBe(true);
    expect(computeAllowTrustedHeaders(false, true, false)).toBe(true);
  });

  it('dev sin Supabase configurado: permitido (fallback de desarrollo)', () => {
    expect(computeAllowTrustedHeaders(false, false, false)).toBe(true);
  });

  it('dev con Supabase configurado y AUTH_TRUST_HEADERS=false: JWT-only (false)', () => {
    expect(computeAllowTrustedHeaders(false, false, true)).toBe(false);
  });
});
