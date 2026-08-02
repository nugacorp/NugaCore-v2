import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildOltCommandPlan,
  isOltActionType,
  missingPayloadFields,
  OLT_ACTION_TYPES,
  type OltActionType,
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

type NonCustomAction = Exclude<OltActionType, 'custom'>;
type RequiredPayloadField = 'serial' | 'ponPort' | 'onuIndex' | 'vlan';

const NON_CUSTOM_ACTIONS = OLT_ACTION_TYPES.filter(
  (action): action is NonCustomAction => action !== 'custom',
);

const REQUIRED_FIELDS_BY_ACTION: Record<NonCustomAction, RequiredPayloadField[]> = {
  provision_onu: ['serial', 'ponPort', 'onuIndex', 'vlan'],
  deauthorize_onu: ['ponPort', 'onuIndex'],
  suspend_onu: ['ponPort', 'onuIndex'],
  restore_onu: ['ponPort', 'onuIndex'],
  reboot_onu: ['ponPort', 'onuIndex'],
};

const PLACEHOLDER_BY_FIELD: Record<RequiredPayloadField, string> = {
  serial: '<SERIE>',
  ponPort: '<PON>',
  onuIndex: '<N>',
  vlan: '<VLAN>',
};

// SHA-256 de JSON.stringify(commands), extraídos directamente del blob c6ad482.
const BASE_COMMAND_DIGESTS_C6AD482: Record<string, string> = {
  'huawei/provision_onu': '61aef094f37d3e795f2652ae35fe39be033ffc5a4c4522740744051676ebc8d5',
  'huawei/deauthorize_onu': 'c2ece4ec8e7d6616758c880ee1ec9474cb249bbf03e66b9140c5ddf8c515bbeb',
  'huawei/suspend_onu': '21d6da755c2f0d68d45c22411e242ad3412aa164d33f1ee4c50c60744a5383b3',
  'huawei/restore_onu': 'ca42b55e818eee1d5d418feba3187e2d861dc4bd5199c07145ed93af7dc7954d',
  'huawei/reboot_onu': '6cf86c31b25ca6774577987be2f428e3792ebeeee14857996d17d8dcd3f62a6d',
  'zte/provision_onu': '8983ded672304fa00cd2df4a3047fae35c1de24c771730540b7cfa3bbf890ca5',
  'zte/deauthorize_onu': 'd54edfc0b666e96f5a1eac9cedc1864643e867590179fdb668e49bd30535c19e',
  'zte/suspend_onu': '65138ff9b70703909885affbaf76d286f84a2eb944c42c0247ed637e1afc671f',
  'zte/restore_onu': 'aa8dbe3e9a851654f54ad2e7b4c013bb3bf395eac8493de9ebcf60764d54e3bf',
  'zte/reboot_onu': '8b9749934ee1f77f1736087710dce9d2e804e0b954411ae9c42799bb3b47661a',
  'vsol-bdcom/provision_onu': 'c14886256264841bd954bc58526d6d739e9141d212d05cdb5bf7aa44bbd575e2',
  'vsol-bdcom/deauthorize_onu': 'db684b38e197ee73bdc3dcccf89ee8dcf253589adf97ad81af8b559301a1757a',
  'vsol-bdcom/suspend_onu': '0e7122f7733d06ff1196eafe80af9a9fa0784ac23b83fbfe76e8ca45b21704c1',
  'vsol-bdcom/restore_onu': 'fdb25e6c085ac2005329aba7f38e51e511622580654ec22c5dce8ead277b129e',
  'vsol-bdcom/reboot_onu': 'f28dd90a12c7f59f2c2a9913afbd69b03bc85458e0231da79e9d427d6ffcdccf',
  'cdata/provision_onu': '56ad1775c4df6bdbd086cb8ce38600f5f8f7492c4d1377a329b69b165986265e',
  'cdata/deauthorize_onu': 'f60f647de2ed33d5cee70f8bf30f0a38419833352e2892e54e543e71bdb050b0',
  'cdata/suspend_onu': '04b2c49a428d9ff797d638c5839993db40a122203b7756c0c634227424c5d654',
  'cdata/restore_onu': 'c4aeea81b8bfc5ab03eec8f6bfe72ab473d754e0806705065df1a9f0cf16c55c',
  'cdata/reboot_onu': '7ece2d66f10e07d46afed72f0642b1f23532b6ccf93312f6d8703c3a50f0c6a3',
  'fiberhome/provision_onu': 'a3607fbb9e2c9c9b91dfdf163a16b818fce30525569acfdb72b5b99f1e5f3a32',
  'fiberhome/deauthorize_onu': '594f6a2a0be1fdb367220b5e2d7fa27d9a4d4893955e9f45099aaff9258a3385',
  'fiberhome/suspend_onu': 'dd6d7d61f8bebc9a7d27580c85abd22eb4480d12b6533e94c175b5c5d25303fd',
  'fiberhome/restore_onu': 'bbd654fef46072209644b6fb9f8a961729a8da275a8ee015f5b2d48cff9603a4',
  'fiberhome/reboot_onu': '8d02322b052b0dd025e0e0324c8c0925f1d1e6cfd4b5c471604b8e3ba8193983',
  'generic/provision_onu': '1be0e33eccf4d9fd43d03d0c733823ad147f04360d61a5d1858887e9db3ef635',
  'generic/deauthorize_onu': 'e4bd4aecceda2884dee070776371eaa8ff7fc3a491e2a4c01fc4907cc0841e83',
  'generic/suspend_onu': '61809820caf58af3ea757bb4de60ca480f8fb320d3ac4653724a123ac3fe38d1',
  'generic/restore_onu': 'a66f103b12f70eea815a234e2c7253c8da3b09f9c629936f3fd37eede516aca2',
  'generic/reboot_onu': 'b8a8e841a74dc6f5b014a590544a90006d3ee8c92c750c7b224507c2c442c266',
};

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

  it('cubre placeholders y valores null en toda la matriz no-custom', () => {
    for (const action of NON_CUSTOM_ACTIONS) {
      const requiredFields = REQUIRED_FIELDS_BY_ACTION[action];
      const incompletePayloads = [
        {},
        Object.fromEntries(requiredFields.map((field) => [field, null])) as unknown as OnuActionPayload,
      ];

      for (const payload of incompletePayloads) {
        expect(missingPayloadFields(action, payload), `${action} REQUIRED_FIELDS`).toEqual(requiredFields);

        const plans = FLAVORS.map((flavor) => ({
          flavor,
          plan: buildOltCommandPlan(flavor, action, payload),
        }));

        for (const { flavor, plan } of plans) {
          const caseName = `${flavor}/${action}`;
          const copyablePlan = [...plan.commands, ...plan.warnings].join('\n');
          const allowsFiberhomePasswordNull = flavor === 'fiberhome' && action === 'provision_onu';
          const checkedPlan = allowsFiberhomePasswordNull
            ? copyablePlan.replace('password null', 'password')
            : copyablePlan;

          expect(checkedPlan, `${caseName} no debe interpolar undefined/null`).not.toMatch(
            /\b(?:undefined|null)\b/,
          );
          expect(copyablePlan.match(/\bnull\b/g) ?? [], `${caseName} null permitido`).toHaveLength(
            allowsFiberhomePasswordNull ? 1 : 0,
          );

          const missingWarning = plan.warnings.find((warning) => warning.startsWith('Faltan datos')) ?? '';
          for (const field of requiredFields) {
            expect(missingWarning, `${caseName} warning ${field}`).toContain(field);
          }
          for (const field of Object.keys(PLACEHOLDER_BY_FIELD) as RequiredPayloadField[]) {
            if (!requiredFields.includes(field)) {
              expect(missingWarning, `${caseName} no debe exigir ${field}`).not.toContain(field);
            }
          }
        }

        const commandsForAction = plans.flatMap(({ plan }) => plan.commands).join('\n');
        for (const field of requiredFields) {
          expect(commandsForAction, `${action} placeholder ${field}`).toContain(PLACEHOLDER_BY_FIELD[field]);
        }
      }
    }
  });

  it('mantiene comandos exactos de c6ad482 para las 30 combinaciones completas', () => {
    expect(Object.keys(BASE_COMMAND_DIGESTS_C6AD482)).toHaveLength(FLAVORS.length * NON_CUSTOM_ACTIONS.length);

    for (const flavor of FLAVORS) {
      for (const action of NON_CUSTOM_ACTIONS) {
        const caseName = `${flavor}/${action}`;
        const commands = buildOltCommandPlan(flavor, action, FULL).commands;
        const digest = createHash('sha256').update(JSON.stringify(commands)).digest('hex');
        expect(digest, caseName).toBe(BASE_COMMAND_DIGESTS_C6AD482[caseName]);
      }
    }
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
