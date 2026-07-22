// ====================================================================
// IPAM de la VPN WireGuard (Fase 4.6.1).
//
// Pool por defecto 10.70.0.0/16. Asignación automática secuencial, sin
// duplicados, reutilizando IPs liberadas (revocación de peers).
//
// La .1 se reserva para el servidor; los peers empiezan en .2.
// Funciones PURAS sobre una lista de asignaciones (persistida por el repo).
// ====================================================================

export interface IpAllocationLite {
  ip: string;
  status: 'allocated' | 'released';
}

export const DEFAULT_WG_POOL = '10.70.0.0/16';
export const DEFAULT_SERVER_IP = '10.70.0.1';

const ipToInt = (ip: string): number => {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};
const intToIp = (n: number): string =>
  [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');

/** Rango utilizable de un CIDR (excluye network y broadcast). */
export const poolRange = (cidr: string): { first: number; last: number } => {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const baseInt = ipToInt(base);
  const size = 2 ** (32 - bits);
  const network = baseInt & (size > 1 ? ~(size - 1) >>> 0 : 0xffffffff);
  return { first: network + 1, last: network + size - 2 };
};

/**
 * Devuelve la siguiente IP libre del pool, prefiriendo IPs liberadas (menor
 * primero). Excluye `reserved` (p.ej. la IP del servidor) y las ya asignadas.
 * Devuelve null si el pool está agotado.
 *
 * Las liberadas SOLO se reutilizan si caen DENTRO del `cidr` pedido: al ser
 * `wg0` compartido entre tenants (un /24 por tenant sobre un mismo pool), una
 * liberada de otro bloque no debe fugarse a este (bug de reuse cruzado).
 */
export const nextFreeIp = (
  allocations: IpAllocationLite[],
  cidr: string = DEFAULT_WG_POOL,
  reserved: string[] = [DEFAULT_SERVER_IP],
): string | null => {
  const reservedInts = new Set(reserved.map(ipToInt));
  const allocatedInts = new Set(
    allocations.filter((a) => a.status === 'allocated').map((a) => ipToInt(a.ip)),
  );
  const { first, last } = poolRange(cidr);
  const inPool = (n: number) => n >= first && n <= last;

  // 1) Reutilizar la IP liberada más baja DEL BLOQUE pedido, no reservada ni
  //    re-asignada. Fuera del bloque no se toca (aislamiento entre tenants).
  const released = allocations
    .filter((a) => a.status === 'released')
    .map((a) => ipToInt(a.ip))
    .filter((n) => inPool(n) && !reservedInts.has(n) && !allocatedInts.has(n))
    .sort((a, b) => a - b);
  if (released.length > 0) return intToIp(released[0]);

  // 2) Siguiente IP secuencial no usada dentro del bloque. Las IPs a saltar
  //    (servidor, .1 de gateway, etc.) llegan vía `reserved`.
  for (let n = first; n <= last; n++) {
    if (!reservedInts.has(n) && !allocatedInts.has(n)) return intToIp(n);
  }
  return null;
};
