import { describe, expect, it } from 'vitest';
import {
  classifyRxPower,
  FTTH_RX_POWER_MIN_DBM,
  FTTH_RX_POWER_WARN_DBM,
  parseFtthFields,
  parseWorkOrderTechnology,
  validateFtthCompletion,
} from '../../backend/domains/tickets/ftth-checklist';

const COMPLETE = {
  onuSerial: '48575443A1B2C3D4',
  napId: 'NAP-01',
  napPort: 6,
  rxPowerDbm: -21.4,
};

describe('Clasificación de potencia óptica', () => {
  it('separa buena, degradada, baja y saturada', () => {
    expect(classifyRxPower(-21)).toBe('good');
    expect(classifyRxPower(-26)).toBe('degraded');
    expect(classifyRxPower(-28.5)).toBe('too_low');
    expect(classifyRxPower(-5)).toBe('too_high');
  });

  it('los límites exactos no son degradados ni bajos', () => {
    expect(classifyRxPower(FTTH_RX_POWER_WARN_DBM)).toBe('good');
    expect(classifyRxPower(FTTH_RX_POWER_MIN_DBM)).toBe('degraded');
  });
});

describe('Gate de cierre de órdenes FTTH', () => {
  it('no toca el flujo de radio', () => {
    expect(validateFtthCompletion({ technology: 'radio', ftth: undefined }).ok).toBe(true);
    expect(validateFtthCompletion({ technology: undefined, ftth: undefined }).ok).toBe(true);
  });

  it('cierra una instalación de fibra completa y en rango', () => {
    const result = validateFtthCompletion({ technology: 'fiber', ftth: COMPLETE });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('bloquea el cierre si falta cualquier dato del checklist', () => {
    const result = validateFtthCompletion({ technology: 'fiber', ftth: {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FTTH_CHECKLIST_INCOMPLETE');
    expect(result.errors).toHaveLength(4);
    expect(result.errors.join(' ')).toMatch(/serie de la ONU/i);
    expect(result.errors.join(' ')).toMatch(/potencia óptica/i);
  });

  it('bloquea potencia peor que el mínimo aceptable', () => {
    const result = validateFtthCompletion({
      technology: 'fiber',
      ftth: { ...COMPLETE, rxPowerDbm: -29.2 },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FTTH_RX_POWER_OUT_OF_RANGE');
    expect(result.errors[0]).toMatch(/revisar la fusión/i);
  });

  it('bloquea potencia excesiva (receptor saturado)', () => {
    const result = validateFtthCompletion({
      technology: 'fiber',
      ftth: { ...COMPLETE, rxPowerDbm: -4 },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FTTH_RX_POWER_OUT_OF_RANGE');
    expect(result.errors[0]).toMatch(/satura/i);
  });

  it('deja cerrar en zona degradada pero lo advierte', () => {
    const result = validateFtthCompletion({
      technology: 'fiber',
      ftth: { ...COMPLETE, rxPowerDbm: -26.3 },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatch(/poco margen/i);
  });

  it('rechaza puertos de NAP inválidos', () => {
    const result = validateFtthCompletion({
      technology: 'fiber',
      ftth: { ...COMPLETE, napPort: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/entero positivo/i);
  });
});

describe('Normalización de entrada', () => {
  it('acepta sinónimos de tecnología', () => {
    expect(parseWorkOrderTechnology('FIBER')).toBe('fiber');
    expect(parseWorkOrderTechnology('ftth')).toBe('fiber');
    expect(parseWorkOrderTechnology('wisp')).toBe('radio');
    expect(parseWorkOrderTechnology('satelital')).toBeNull();
  });

  it('descarta campos vacíos y no numéricos', () => {
    expect(parseFtthFields({ onuSerial: '  ', rxPowerDbm: '' })).toBeUndefined();
    expect(parseFtthFields({ rxPowerDbm: 'abc', napPort: '6' })).toEqual({
      onuSerial: undefined,
      napId: undefined,
      napPort: 6,
      rxPowerDbm: undefined,
      txPowerDbm: undefined,
      spliceLossDb: undefined,
      measuredAt: undefined,
    });
  });

  it('conserva potencias negativas y decimales', () => {
    expect(parseFtthFields({ rxPowerDbm: '-21.45' })?.rxPowerDbm).toBe(-21.45);
  });
});
