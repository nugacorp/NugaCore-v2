import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { SNMP_OIDS, snmpGetV2c } from '../../backend/domains/snmp-poller/client';

const sockets: dgram.Socket[] = [];

const encodeLength = (length: number): Buffer => {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

const tlv = (tag: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body]);

const integer = (value: number): Buffer => tlv(0x02, Buffer.from([value]));

const oidBody = (oid: string): Buffer => {
  const parts = oid.split('.').map(Number);
  const encoded: number[] = [parts[0] * 40 + parts[1]];
  for (const initial of parts.slice(2)) {
    let value = initial;
    const bytes: number[] = [];
    do {
      bytes.unshift(value & 0x7f);
      value >>>= 7;
    } while (value > 0);
    bytes.forEach((byte, index) => encoded.push(index < bytes.length - 1 ? byte | 0x80 : byte));
  }
  return Buffer.from(encoded);
};

const varbind = (oid: string, value: Buffer): Buffer =>
  tlv(0x30, Buffer.concat([tlv(0x06, oidBody(oid)), value]));

const buildResponse = (): Buffer => {
  const varbinds = tlv(0x30, Buffer.concat([
    varbind(SNMP_OIDS.sysUpTime, tlv(0x43, Buffer.from([0, 0, 0, 42]))),
    varbind(SNMP_OIDS.sysName, tlv(0x04, Buffer.from('router-real'))),
  ]));
  const responsePdu = tlv(0xa2, Buffer.concat([
    integer(1),
    integer(0),
    integer(0),
    varbinds,
  ]));
  return tlv(0x30, Buffer.concat([
    integer(1),
    tlv(0x04, Buffer.from('test-community')),
    responsePdu,
  ]));
};

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

describe('SNMPv2c client', () => {
  it('decodifica sysUpTime y sysName de una respuesta GetResponse válida', async () => {
    const server = dgram.createSocket('udp4');
    sockets.push(server);
    await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'string') throw new Error('Se esperaba una dirección UDP IPv4.');

    const response = buildResponse();
    server.on('message', (_message, remote) => {
      server.send(response, remote.port, remote.address);
    });

    const result = await snmpGetV2c(
      '127.0.0.1',
      'test-community',
      [SNMP_OIDS.sysUpTime, SNMP_OIDS.sysName],
      1_000,
      address.port,
    );

    expect(result.ok).toBe(true);
    expect(result.values.get(SNMP_OIDS.sysUpTime)).toBe('42');
    expect(result.values.get(SNMP_OIDS.sysName)).toBe('router-real');
  });
});
