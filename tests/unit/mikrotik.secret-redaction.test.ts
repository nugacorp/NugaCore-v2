import { describe, it, expect } from 'vitest';
import {
  REDACTED,
  redactSecret,
  redactString,
  redactScript,
  redactObject,
} from '../../backend/common/secret-redaction';
import { generateProvisioningScript } from '../../backend/domains/mikrotik/provisioning/script-generator';
import type { ScriptGenerationInput } from '../../backend/domains/mikrotik/provisioning/types';
import { safeScriptSnapshot } from '../helpers/safe-script-snapshot';

// ====================================================================
// Fase 4.4.1 — redacción de secretos + snapshot seguro.
// ====================================================================

describe('redactSecret', () => {
  it('colapsa cualquier valor no vacío', () => {
    expect(redactSecret('Abc123')).toBe(REDACTED);
    expect(redactSecret('')).toBe('');
    expect(redactSecret(undefined)).toBe('');
  });
});

describe('redactString', () => {
  it('redacta password=valor (con y sin comillas)', () => {
    expect(redactString('password=Abc123')).toBe(`password=${REDACTED}`);
    expect(redactString('/user add password="S3cr et!" group=x')).toContain(`password=${REDACTED}`);
    expect(redactString('/user add password="S3cr et!" group=x')).not.toContain('S3cr et!');
  });

  it('redacta token y secret', () => {
    expect(redactString('provisioning-token=XYZ.123')).toContain(`token=${REDACTED}`);
    expect(redactString('secret: topsecret')).toContain(`secret: ${REDACTED}`);
  });

  it('redacta Bearer y JWT', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi')).toContain(`Bearer ${REDACTED}`);
    const jwt = 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJ';
    expect(redactString(`token ${jwt}`)).toContain(REDACTED);
    expect(redactString(`token ${jwt}`)).not.toContain(jwt);
  });

  it('NO redacta public-key (WireGuard, material público)', () => {
    const line = '/interface wireguard peers add public-key="ABCpub=" endpoint-address=host';
    expect(redactString(line)).toContain('public-key="ABCpub="');
  });
});

describe('redactObject', () => {
  it('redacta valores con claves secretas en profundidad', () => {
    const input = {
      name: 'Router 1',
      apiPassword: 'p4ss',
      nested: { provisioningToken: 'tok', vpnPassword: 'vp', ok: 'visible' },
      list: [{ encryptedPassword: 'iv.tag.ct' }],
    };
    const out = redactObject(input);
    expect(out.name).toBe('Router 1');
    expect(out.apiPassword).toBe(REDACTED);
    expect(out.nested.provisioningToken).toBe(REDACTED);
    expect(out.nested.vpnPassword).toBe(REDACTED);
    expect(out.nested.ok).toBe('visible');
    expect(out.list[0].encryptedPassword).toBe(REDACTED);
  });

  it('redacta secretos embebidos en valores string', () => {
    const out = redactObject({ summary: 'user=x password=leak123 hash=ab' });
    expect(out.summary).toContain(`password=${REDACTED}`);
    expect(out.summary).not.toContain('leak123');
  });

  it('tolera ciclos', () => {
    const a: any = { name: 'x' };
    a.self = a;
    expect(() => redactObject(a)).not.toThrow();
  });
});

const baseInput = (over: Partial<ScriptGenerationInput> = {}): ScriptGenerationInput => ({
  connectionType: 'sstp',
  routerName: 'Router Core',
  apiUser: 'nugacore_abc123',
  apiPassword: 'ApiPlaintextPasswordValue_1234567890ABCDEF',
  apiPort: 8728,
  vpnUser: 'nugacore_vpn1',
  vpnPassword: 'VpnPlaintextPasswordValue_0987654321ZYXWVU',
  server: { vpnHost: 'vpn.nugacore.local', vpnCidr: '10.10.0.0/24', serverManagementCidr: '10.0.0.0/24' },
  ...over,
});

describe('redactScript / safeScriptSnapshot', () => {
  it('redacta los passwords del script pero conserva la estructura NugaCore', () => {
    const { script } = generateProvisioningScript(baseInput());
    const safe = redactScript(script);
    expect(safe).not.toContain('ApiPlaintextPasswordValue_1234567890ABCDEF');
    expect(safe).not.toContain('VpnPlaintextPasswordValue_0987654321ZYXWVU');
    expect(safe).toContain(`password=${REDACTED}`);
    expect(safe).toContain('NugaCore');
    expect(safe).toContain('policy="read,write,api,test"');
  });

  it('safeScriptSnapshot normaliza usernames volátiles y queda estable', () => {
    const a = safeScriptSnapshot(generateProvisioningScript(baseInput()).script);
    const b = safeScriptSnapshot(generateProvisioningScript(baseInput()).script);
    expect(a).toContain('nugacore_<ID>');
    expect(a).not.toContain('ApiPlaintextPasswordValue_1234567890ABCDEF');
    // Determinista entre ejecuciones (sin secretos ni ids aleatorios).
    expect(a).toBe(b);
  });
});
