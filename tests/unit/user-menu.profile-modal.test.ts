import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('UserMenu — modal de perfil responsive', () => {
  const source = readFileSync('src/components/UserMenu.tsx', 'utf8');

  it('renderiza el modal con portal al body (evita quedar bajo el sidebar)', () => {
    expect(source).toContain('createPortal');
    expect(source).toContain('document.body');
    expect(source).toContain('user-profile-modal');
    expect(source).toMatch(/z-\[100\]/);
  });

  it('limita altura y permite scroll en pantallas pequeñas', () => {
    expect(source).toMatch(/max-h-\[92dvh\]|max-h-\[90vh\]/);
    expect(source).toContain('overflow-y-auto');
    expect(source).toContain('break-all');
  });
});
