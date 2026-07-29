import { describe, expect, it } from 'vitest';
import {
  buildOltCommandPlan,
  isOltActionType,
  missingPayloadFields,
  OLT_ACTION_TYPES,
  type OnuActionPayload,
} from '../../backend/domains/olt/command-builder';
import type { OltCliFlavor } from '../../backend/domains/olt/types';

const FULL: OnuActionPayload = {
  serial: '48575443A1B2C3D4',
  ponPort: '0/1/0',
  onuIndex: 3,
  vlan: 100,
  onuType: 'F660',
  description: 'Sofía Rodríguez',
};

const FLAVORS: OltCliFlavor[] = ['huawei', 'zte', 'vsol-bdcom', 'cdata', 'fiberhome', 'generic'];

describe('Command builder multi-vendor', () => {
  it('cubre todas las acciones en todas las familias de CLI', () => {
    for (const flavor of FLAVORS) {
      for (const action of OLT_ACTION_TYPES) {
        const plan = buildOltCommandPlan(flavor, action, { ...FULL, rawCommands: ['show version'] });
        expect(plan.flavor, `${flavor}/${action}`).toBe(flavor);
        expect(plan.commands.length, `${flavor}/${action} sin comandos`).toBeGreaterThan(0);
      }
    }
  });

  it('Huawei parte el PON en interfaz + puerto y usa sn-auth', () => {
    const plan = buildOltCommandPlan('huawei', 'provision_onu', FULL);
    const joined = plan.commands.join('\n');
    expect(joined).toContain('interface gpon 0/1');
    expect(joined).toContain('ont add 0 3 sn-auth "48575443A1B2C3D4"');
    expect(joined).toContain('service-port vlan 100 gpon 0/1/0 ont 3');
  });

  it('ZTE usa gpon-olt_/gpon-onu_ y el tipo de ONU', () => {
    const plan = buildOltCommandPlan('zte', 'provision_onu', { ...FULL, ponPort: '1/1/1' });
    const joined = plan.commands.join('\n');
    expect(joined).toContain('interface gpon-olt_1/1/1');
    expect(joined).toContain('onu 3 type F660 sn 48575443A1B2C3D4');
    expect(joined).toContain('interface gpon-onu_1/1/1:3');
  });

  it('suspender y reactivar son opuestos exactos en cada familia IOS-like', () => {
    for (const flavor of ['zte', 'vsol-bdcom'] as OltCliFlavor[]) {
      const suspend = buildOltCommandPlan(flavor, 'suspend_onu', FULL).commands.join('\n');
      const restore = buildOltCommandPlan(flavor, 'restore_onu', FULL).commands.join('\n');
      expect(suspend, flavor).toContain(' shutdown');
      expect(restore, flavor).toContain(' no shutdown');
    }
    expect(buildOltCommandPlan('huawei', 'suspend_onu', FULL).commands.join('\n')).toContain('ont deactivate');
    expect(buildOltCommandPlan('huawei', 'restore_onu', FULL).commands.join('\n')).toContain('ont activate');
  });

  it('marca los campos faltantes en vez de fallar', () => {
    expect(missingPayloadFields('provision_onu', {})).toEqual(['serial', 'ponPort', 'onuIndex', 'vlan']);
    const plan = buildOltCommandPlan('huawei', 'provision_onu', {});
    expect(plan.commands.length).toBeGreaterThan(0);
    expect(plan.warnings.join(' ')).toMatch(/Faltan datos/);
    expect(plan.warnings.join(' ')).toMatch(/serial/);
  });

  it('la familia generic advierte que el plan no es ejecutable', () => {
    const plan = buildOltCommandPlan('generic', 'provision_onu', FULL);
    expect(plan.warnings.join(' ')).toMatch(/no ejecutables|no es|guía/i);
    expect(plan.commands.every((c) => c.startsWith('!'))).toBe(true);
  });

  it('siempre exige revisión manual del plan', () => {
    for (const flavor of FLAVORS) {
      const plan = buildOltCommandPlan(flavor, 'provision_onu', FULL);
      expect(plan.warnings[0], flavor).toMatch(/verificar contra el manual/i);
    }
  });

  it('neutraliza comillas y saltos de línea en datos del cliente', () => {
    const plan = buildOltCommandPlan('huawei', 'provision_onu', {
      ...FULL,
      serial: 'ABC"123\nquit',
      description: 'Cliente "VIP"\nundo',
    });
    const joined = plan.commands.join('\n');
    expect(joined).not.toMatch(/ABC"123/);
    expect(joined).toContain('ABC123quit');
    expect(joined.split('\n').filter((l) => l.trim() === 'undo')).toHaveLength(0);
  });

  it('custom sin comandos deja el plan vacío y lo advierte', () => {
    const plan = buildOltCommandPlan('huawei', 'custom', {});
    expect(plan.commands).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/custom sin comandos/i);
  });

  it('valida el tipo de acción', () => {
    expect(isOltActionType('provision_onu')).toBe(true);
    expect(isOltActionType('rm -rf')).toBe(false);
    expect(isOltActionType(undefined)).toBe(false);
  });
});
