// ====================================================================
// Cliente SNMPv2c mínimo (UDP) — sin dependencias nativas.
// ====================================================================

import dgram from 'dgram';

const SYS_UP_TIME_OID = '1.3.6.1.2.1.1.3.0';
const SYS_NAME_OID = '1.3.6.1.2.1.1.5.0';

const encodeOid = (oid: string): Buffer => {
  const parts = oid.split('.').map((p) => Number.parseInt(p, 10));
  const buf: number[] = [0x06]; // OID type
  const encoded: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    if (v < 128) {
      encoded.push(v);
    } else {
      const stack: number[] = [];
      while (v > 0) {
        stack.unshift(v & 0x7f);
        v >>= 7;
      }
      stack.forEach((b, idx) => encoded.push(idx < stack.length - 1 ? b | 0x80 : b));
    }
  }
  buf.push(encoded.length);
  return Buffer.from([...buf, ...encoded]);
};

const encodeString = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'ascii');
  return Buffer.from([0x04, bytes.length, ...bytes]);
};

const encodeConstructed = (tag: number, items: Buffer[]): Buffer => {
  const body = Buffer.concat(items);
  return Buffer.from([tag, body.length, ...body]);
};

const encodeSequence = (items: Buffer[]): Buffer => encodeConstructed(0x30, items);

const buildGetRequest = (community: string, oids: string[], requestId: number): Buffer => {
  const id = Buffer.from([0x02, 0x01, requestId & 0xff]);
  const version = Buffer.from([0x02, 0x01, 0x01]); // v2c
  const comm = encodeString(community);
  const pduChildren: Buffer[] = [];
  for (const oid of oids) {
    pduChildren.push(encodeSequence([encodeOid(oid), Buffer.from([0x05, 0x00])])); // null value
  }
  const varbindList = encodeSequence(pduChildren);
  const pdu = encodeConstructed(0xa0, [
    id,
    Buffer.from([0x02, 0x01, 0x00]), // error-status
    Buffer.from([0x02, 0x01, 0x00]), // error-index
    varbindList,
  ]);
  return encodeSequence([version, comm, pdu]);
};

const readLength = (buf: Buffer, offset: number): { length: number; next: number } => {
  const first = buf[offset];
  if (first < 0x80) return { length: first, next: offset + 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = (length << 8) + buf[offset + 1 + i];
  return { length, next: offset + 1 + numBytes };
};

const parseVarbindValue = (buf: Buffer, offset: number): { value: string; next: number } => {
  const tag = buf[offset];
  const { length, next } = readLength(buf, offset + 1);
  const data = buf.subarray(next, next + length);
  const readUnsigned = (): number => {
    let value = 0;
    for (const byte of data) value = value * 256 + byte;
    return value;
  };
  if (tag === 0x04 || tag === 0x41) return { value: data.toString('utf8'), next: next + length };
  if (tag === 0x02) {
    return { value: String(readUnsigned()), next: next + length };
  }
  if (tag === 0x43) return { value: String(readUnsigned()), next: next + length };
  return { value: data.toString('hex'), next: next + length };
};

const parseGetResponse = (buf: Buffer): Map<string, string> => {
  const out = new Map<string, string>();
  try {
    const walk = (from: number, limit: number): void => {
      let i = from;
      while (i < limit) {
        const tag = buf[i];
        const lenInfo = readLength(buf, i + 1);
        const start = lenInfo.next;
        const end = start + lenInfo.length;
        if (end > limit || end > buf.length) return;

        if (tag === 0x30 && buf[start] === 0x06) {
          const oidLen = readLength(buf, start + 1);
          const oidStart = oidLen.next;
          const oidEnd = oidStart + oidLen.length;
          if (oidEnd > end) return;

          const oidBytes = buf.subarray(oidStart, oidEnd);
          const oidParts: number[] = [];
          if (oidBytes.length > 0) {
            oidParts.push(Math.floor(oidBytes[0] / 40), oidBytes[0] % 40);
            let k = 1;
            while (k < oidBytes.length) {
              let value = 0;
              while (k < oidBytes.length) {
                const byte = oidBytes[k++];
                value = (value << 7) + (byte & 0x7f);
                if ((byte & 0x80) === 0) break;
              }
              oidParts.push(value);
            }
          }

          if (oidEnd < end) {
            const parsed = parseVarbindValue(buf, oidEnd);
            const oid = oidParts.join('.');
            if (oid) out.set(oid, parsed.value);
          }
        } else if ((tag & 0x20) !== 0) {
          walk(start, end);
        }

        i = end;
      }
    };

    walk(0, buf.length);
  } catch {
    return out;
  }
  return out;
};

export interface SnmpGetResult {
  ok: boolean;
  values: Map<string, string>;
  latencyMs: number;
  error?: string;
}

export async function snmpGetV2c(
  host: string,
  community: string,
  oids: string[] = [SYS_UP_TIME_OID, SYS_NAME_OID],
  timeoutMs = 3000,
  port = 161,
): Promise<SnmpGetResult> {
  const started = Date.now();
  const packet = buildGetRequest(community, oids, Math.floor(Math.random() * 200) + 1);

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;

    const finish = (result: SnmpGetResult) => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, values: new Map(), latencyMs: Date.now() - started, error: 'timeout' });
    }, timeoutMs);

    socket.on('message', (msg) => {
      clearTimeout(timer);
      const values = parseGetResponse(msg);
      finish({
        ok: values.size > 0,
        values,
        latencyMs: Date.now() - started,
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        values: new Map(),
        latencyMs: Date.now() - started,
        error: err.message,
      });
    });

    socket.send(packet, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        finish({ ok: false, values: new Map(), latencyMs: Date.now() - started, error: err.message });
      }
    });
  });
}

export const SNMP_OIDS = {
  sysUpTime: SYS_UP_TIME_OID,
  sysName: SYS_NAME_OID,
} as const;
