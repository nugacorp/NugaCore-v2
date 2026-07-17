import { describe, expect, it } from 'vitest';
import { messageForAuthEmailError } from '../../src/lib/authEmailErrors';

describe('messageForAuthEmailError', () => {
  it('traduce rate limit de Supabase', () => {
    const msg = messageForAuthEmailError(new Error('email rate limit exceeded'), 'fallback');
    expect(msg).toMatch(/Límite de correos/i);
    expect(msg).not.toMatch(/rate limit exceeded/i);
  });

  it('usa fallback si el error está vacío', () => {
    expect(messageForAuthEmailError(null, 'No se pudo')).toBe('No se pudo');
  });
});
