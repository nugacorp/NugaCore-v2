import { describe, expect, it } from 'vitest';
import { listCatalog, suggestConfig, isKnownModel } from '../../backend/domains/olt/config-advisor';
import { generateOltScript } from '../../backend/domains/olt/script-generator';
import type { OltDevice } from '../../backend/domains/olt/types';

const device = (over: Partial<OltDevice> = {}): OltDevice => ({
  id: 'olt-test', tenantId: 'tenant-default', name: 'OLT Centro', brand: 'Huawei',
  model: 'MA5608T', ponType: 'gpon', managementIp: '10.200.1.2', managementVlan: 100,
  sshPort: 22, sshUsername: undefined, provisioningStatus: 'planned', configProfile: {},
  createdAt: 'x', updatedAt: 'x', ...over,
});

describe('OLT config-advisor', () => {
  it('el catálogo trae marcas comunes con sus modelos', () => {
    const cat = listCatalog();
    const brands = cat.map((c) => c.brand);
    expect(brands).toContain('Huawei');
    expect(brands).toContain('ZTE');
    const huawei = cat.find((c) => c.brand === 'Huawei');
    expect(huawei?.models).toContain('MA5608T');
  });

  it('sugiere config estable para un modelo conocido', () => {
    const rec = suggestConfig({ brand: 'Huawei', model: 'MA5608T' });
    expect(rec.cliFlavor).toBe('huawei');
    expect(rec.ponType).toBe('gpon');
    expect(rec.capacity.recommendedSplit).toBe('1:64');
    const keys = rec.settings.map((s) => s.key);
    expect(keys).toContain('management_vlan');
    expect(keys).toContain('ssh_only');
    expect(keys).toContain('onu_auth_mode');
    expect(isKnownModel('Huawei', 'MA5608T')).toBe(true);
  });

  it('modelo desconocido → recomendación genérica marcada', () => {
    const rec = suggestConfig({ brand: 'MarcaX', model: 'ZZZ' });
    expect(rec.cliFlavor).toBe('generic');
    expect(rec.summary.toLowerCase()).toContain('genérica');
    expect(rec.rationale.join(' ')).toContain('fuera de catálogo');
    expect(isKnownModel('MarcaX', 'ZZZ')).toBe(false);
  });
});

describe('OLT script-generator', () => {
  it('genera script Huawei con SSH-only y usuario SSH', () => {
    const rec = suggestConfig({ brand: 'Huawei', model: 'MA5608T' });
    const out = generateOltScript({ device: device(), recommendation: rec });
    expect(out.oltScript).toContain('stelnet server enable');
    expect(out.oltScript).toContain('undo telnet server enable');
    expect(out.oltScript).toContain(out.sshUsername);
    expect(out.sshUsername).toBe('nugacore-noc');
    expect(out.sshPasswordOnce.length).toBeGreaterThan(10);
  });

  it('el snippet MikroTik hace la OLT alcanzable por WireGuard (masquerade + IP)', () => {
    const rec = suggestConfig({ brand: 'ZTE', model: 'C320' });
    const out = generateOltScript({
      device: device({ brand: 'ZTE', model: 'C320', managementIp: '10.200.5.2' }),
      recommendation: rec,
      reachability: { mikrotikWgInterface: 'wg-nuga', mikrotikLanInterface: 'bridge-lan', mikrotikLanIp: '10.200.5.1' },
    });
    expect(out.mikrotikSnippet).toContain('10.200.5.2');
    expect(out.mikrotikSnippet).toContain('masquerade');
    expect(out.mikrotikSnippet).toContain('wg-nuga');
  });

  it('el password SSH es aleatorio (distinto entre llamadas) y NO va en el snippet MikroTik', () => {
    const rec = suggestConfig({ brand: 'Huawei', model: 'MA5608T' });
    const a = generateOltScript({ device: device(), recommendation: rec });
    const b = generateOltScript({ device: device(), recommendation: rec });
    expect(a.sshPasswordOnce).not.toBe(b.sshPasswordOnce);
    expect(a.mikrotikSnippet).not.toContain(a.sshPasswordOnce);
  });

  it('modelo desconocido → esqueleto genérico anotado', () => {
    const rec = suggestConfig({ brand: 'MarcaX', model: 'ZZZ' });
    const out = generateOltScript({ device: device({ brand: 'MarcaX', model: 'ZZZ' }), recommendation: rec });
    expect(out.oltScript).toContain('no catalogada');
  });
});
