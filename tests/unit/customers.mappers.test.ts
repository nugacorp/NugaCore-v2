import { describe, it, expect } from 'vitest';
import type { Client } from '../../src/types';
import {
  ClientRow,
  clientPatchToRow,
  clientToRow,
  rowToClient,
} from '../../backend/domains/customers/mappers';

const fullRow: ClientRow = {
  id: 'c-1',
  full_name: 'Sofia Rodriguez',
  type: 'residential',
  status: 'active',
  email: 'sofia@example.com',
  phone: '5512345678',
  address: 'Av. Insurgentes 1204',
  city: 'CDMX',
  lat: 19.3891,
  lng: -99.1783,
  connection_type: 'FTTH',
  plan_id: 'plan-plus',
  ip_assigned: '10.100.10.12',
  mac_address: 'BC:E6:7C:12:34:56',
  ppp_user: 'sofia_nuga',
  ppp_password: 'secret',
  contract_id: 'CONT-2026-103',
  installation_photos: ['a.jpg'],
  installation_date: '2026-01-12',
  notes: 'cliente vip',
};

describe('customers mappers', () => {
  it('rowToClient mapea snake_case -> camelCase y conserva valores de enum', () => {
    const client = rowToClient(fullRow);
    expect(client.id).toBe('c-1');
    expect(client.name).toBe('Sofia Rodriguez');
    expect(client.status).toBe('active'); // enum NO traducido
    expect(client.type).toBe('residential');
    expect(client.planId).toBe('plan-plus');
    expect(client.ip).toBe('10.100.10.12');
    expect(client.assignedIp).toBe('10.100.10.12');
    expect(client.mac).toBe('BC:E6:7C:12:34:56');
    expect(client.pppoeUser).toBe('sofia_nuga');
    expect(client.connectionType).toBe('FTTH');
    expect(client.installationPhotos).toEqual(['a.jpg']);
  });

  it('rowToClient tolera nulos (campos opcionales y defaults seguros)', () => {
    const sparse: ClientRow = {
      ...fullRow,
      email: null, phone: null, lat: null, lng: null, connection_type: null,
      plan_id: null, ip_assigned: null, mac_address: null, ppp_user: null,
      ppp_password: null, contract_id: null, installation_photos: null,
      installation_date: null, notes: null,
    };
    const client = rowToClient(sparse);
    expect(client.email).toBe('');
    expect(client.phone).toBe('');
    expect(client.lat).toBe(0);
    expect(client.ip).toBe('');
    expect(client.assignedIp).toBe('');
    expect(client.planId).toBe('');
    expect(client.connectionType).toBeUndefined();
    expect(client.mac).toBeUndefined();
    expect(client.installationPhotos).toEqual([]);
  });

  it('clientToRow es inverso de rowToClient en los campos persistidos', () => {
    const client = rowToClient(fullRow);
    const row = clientToRow(client);
    expect(row.full_name).toBe(fullRow.full_name);
    expect(row.status).toBe(fullRow.status);
    expect(row.plan_id).toBe(fullRow.plan_id);
    expect(row.ip_assigned).toBe(fullRow.ip_assigned);
    expect(row.ppp_user).toBe(fullRow.ppp_user);
    expect(row.installation_date).toBe(fullRow.installation_date);
  });

  it('clientPatchToRow solo incluye claves presentes y traduce nombres', () => {
    const patch: Partial<Client> = { status: 'suspended', name: 'Nuevo Nombre' };
    const row = clientPatchToRow(patch);
    expect(row).toEqual({ status: 'suspended', full_name: 'Nuevo Nombre' });
    // no debe incluir columnas no provistas
    expect(Object.keys(row)).toHaveLength(2);
  });

  it('assignedIp reutiliza la columna existente ip_assigned', () => {
    const row = clientToRow({
      ...rowToClient(fullRow),
      ip: '0.0.0.0',
      assignedIp: '192.168.100.25',
    });
    expect(row.ip_assigned).toBe('192.168.100.25');
    expect(clientPatchToRow({ assignedIp: '192.168.100.30' })).toEqual({
      ip_assigned: '192.168.100.30',
    });
  });

  it('clientPatchToRow ignora claves desconocidas (id, documents)', () => {
    const patch = { id: 'c-9', documents: [], city: 'Puebla' } as unknown as Partial<Client>;
    const row = clientPatchToRow(patch);
    expect(row).toEqual({ city: 'Puebla' });
  });
});
