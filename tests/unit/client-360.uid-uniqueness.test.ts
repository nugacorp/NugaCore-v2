import { describe, expect, it, vi, afterEach } from 'vitest';
import { uid } from '../../backend/domains/client-360/memory-store';

// ====================================================================
// `uid` gobierna el `documentId`, y de él cuelga la ruta del objeto en
// Storage (`buildDocumentPath`). Si dos llamadas dentro del mismo
// milisegundo devuelven el mismo id, dos subidas comparten ruta: la
// segunda sobrescribe los bytes de la primera, y borrar una se lleva el
// archivo de la otra.
//
// El reloj se congela a propósito: con `Date.now()` fijo, la única
// defensa que queda es la aleatoriedad. Estos tests fallan contra la
// implementación anterior (`${p}-${Date.now()}`).
// ====================================================================

describe('client-360 uid', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no colisiona dentro del mismo milisegundo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));

    const ids = new Set(Array.from({ length: 1000 }, () => uid('doc')));

    expect(ids.size).toBe(1000);
  });

  it('mantiene el prefijo y un formato apto para rutas de Storage', () => {
    const id = uid('doc');

    expect(id.startsWith('doc-')).toBe(true);
    // La misma validación que aplica el servicio antes de construir la ruta.
    expect(id).toMatch(/^[\w-]{1,64}$/);
  });

  it('distingue prefijos distintos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));

    expect(uid('doc').startsWith('doc-')).toBe(true);
    expect(uid('tag').startsWith('tag-')).toBe(true);
  });
});
