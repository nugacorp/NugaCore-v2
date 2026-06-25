import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/Client360Panel.tsx', 'utf8');

describe('Client 360 Notificaciones section (FASE L)', () => {
  it('muestra sección Notificaciones con datos requeridos', () => {
    expect(source).toContain('aria-label="Notificaciones"');
    expect(source).toContain('client360-notifications');
    expect(source).toContain('Último recordatorio');
    expect(source).toContain('Canal');
    expect(source).toContain('Estado');
    expect(source).toContain('Últimos previews');
  });

  it('tiene acción "Crear recordatorio de pago" que dispara una simulación', () => {
    expect(source).toContain('Crear recordatorio de pago');
    expect(source).toContain("onAction('create-payment-reminder', client)");
  });

  it('aclara que no se envían mensajes reales', () => {
    expect(source).toContain('No se envían mensajes reales.');
  });
});
