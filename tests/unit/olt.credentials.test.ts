import { beforeEach, describe, expect, it } from 'vitest';
import {
  getOltCredentialsService,
  resetOltCredentialsService,
  resetOltCredentialsStore,
} from '../../backend/domains/olt/credentials';

const TENANT = 'tenant-default';
const OLT = 'olt-lab-1';
const PASSWORD = 'S3cr3t-OLT-Passw0rd';

describe('Credenciales OLT cifradas en reposo', () => {
  beforeEach(() => {
    resetOltCredentialsStore();
    resetOltCredentialsService();
  });

  it('no devuelve el password al guardarlo', async () => {
    const meta = await getOltCredentialsService().set(TENANT, OLT, 'nugacore-noc', PASSWORD);
    expect(meta).toMatchObject({
      oltId: OLT,
      username: 'nugacore-noc',
      hasPassword: true,
      isActive: true,
      encryptionVersion: 'v1-aes-256-gcm',
    });
    expect(JSON.stringify(meta)).not.toContain(PASSWORD);
    expect(JSON.stringify(meta)).not.toContain('encryptedPassword');
  });

  it('cifra con AES-256-GCM y descifra solo para uso interno', async () => {
    await getOltCredentialsService().set(TENANT, OLT, 'nugacore-noc', PASSWORD);
    const secret = await getOltCredentialsService().getSecret(TENANT, OLT);
    expect(secret).toEqual({ username: 'nugacore-noc', password: PASSWORD });
  });

  it('la rotación desactiva la credencial anterior y deja una sola activa', async () => {
    await getOltCredentialsService().set(TENANT, OLT, 'user-viejo', PASSWORD);
    await getOltCredentialsService().set(TENANT, OLT, 'user-nuevo', 'Otr0-Passw0rd-Larg0');

    const meta = await getOltCredentialsService().getMeta(TENANT, OLT);
    expect(meta?.username).toBe('user-nuevo');

    const secret = await getOltCredentialsService().getSecret(TENANT, OLT);
    expect(secret?.password).toBe('Otr0-Passw0rd-Larg0');
  });

  it('aísla credenciales por tenant', async () => {
    await getOltCredentialsService().set(TENANT, OLT, 'nugacore-noc', PASSWORD);
    expect(await getOltCredentialsService().getMeta('tenant-otro', OLT)).toBeNull();
    expect(await getOltCredentialsService().getSecret('tenant-otro', OLT)).toBeNull();
  });

  it('devuelve null cuando la OLT no tiene credencial', async () => {
    expect(await getOltCredentialsService().getMeta(TENANT, 'olt-sin-credencial')).toBeNull();
  });
});
