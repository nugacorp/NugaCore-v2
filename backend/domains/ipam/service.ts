import type { Client } from '../../../src/types';
import { getCustomersService } from '../customers/service';
import { ipamRepository, type IpamRepository } from './repository';
import { toPoolView, toRouterView } from './mappers';
import type {
  AvailableIpsResult,
  IpValidationInput,
  IpValidationResult,
  IpamOccupiedAddress,
  IpamPool,
} from './types';

type AssignedClientsProvider = () => Promise<Client[]>;

const ipv4ToNumber = (value: string): number | null => {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    const parsed = Number(part);
    return parsed >= 0 && parsed <= 255 ? parsed : NaN;
  });
  if (octets.some((octet) => !Number.isFinite(octet))) return null;

  return (
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]
  ) >>> 0;
};

const numberToIpv4 = (value: number): string => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
].join('.');

const parseCidr = (cidr: string): { network: number; broadcast: number; prefix: number } | null => {
  const [ip, prefixRaw] = cidr.split('/');
  const ipNumber = ipv4ToNumber(ip);
  const prefix = Number(prefixRaw);
  if (ipNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipNumber & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { network, broadcast, prefix };
};

export const isValidIpv4 = (value: string): boolean => ipv4ToNumber(value) !== null;

export const isIpInCidr = (ip: string, cidr: string): boolean => {
  const ipNumber = ipv4ToNumber(ip);
  const parsed = parseCidr(cidr);
  return ipNumber !== null && parsed !== null && ipNumber >= parsed.network && ipNumber <= parsed.broadcast;
};

const clientIp = (client: Client): string => (client.assignedIp || client.ip || '').trim();

export class IpamService {
  constructor(
    private readonly repository: IpamRepository,
    private readonly assignedClientsProvider: AssignedClientsProvider = async () => [],
  ) {}

  listRouters() {
    return this.repository.listRouters().map(toRouterView);
  }

  listPools(routerId: string) {
    if (!this.repository.findRouter(routerId)) return null;
    return this.repository.listPools(routerId).map(toPoolView);
  }

  private async occupiedForPool(pool: IpamPool): Promise<IpamOccupiedAddress[]> {
    const occupied = this.repository.listOccupied(pool.id);
    const clients = await this.assignedClientsProvider();
    for (const client of clients) {
      const ip = clientIp(client);
      if (!ip || ip === '0.0.0.0' || !isIpInCidr(ip, pool.cidr)) continue;
      if (occupied.some((item) => item.ip === ip)) continue;
      occupied.push({
        ip,
        label: `Cliente ${client.name}`,
        source: 'customer',
      });
    }
    return occupied;
  }

  async availableIps(poolId: string): Promise<AvailableIpsResult | null> {
    const pool = this.repository.findPool(poolId);
    if (!pool) return null;

    const cidr = parseCidr(pool.cidr);
    if (!cidr || cidr.prefix > 30) {
      return {
        routerId: pool.routerId,
        poolId: pool.id,
        cidr: pool.cidr,
        totalAvailable: 0,
        ips: [],
        source: 'mock-local',
      };
    }

    const occupied = new Set((await this.occupiedForPool(pool)).map((item) => item.ip));
    const reserved = new Set([pool.gateway, ...pool.reservedIps]);
    const ips: string[] = [];
    for (let candidate = cidr.network + 1; candidate < cidr.broadcast; candidate += 1) {
      const ip = numberToIpv4(candidate >>> 0);
      if (!occupied.has(ip) && !reserved.has(ip)) ips.push(ip);
    }

    return {
      routerId: pool.routerId,
      poolId: pool.id,
      cidr: pool.cidr,
      totalAvailable: ips.length,
      ips,
      source: 'mock-local',
    };
  }

  async validateIp(input: IpValidationInput): Promise<IpValidationResult> {
    const routerId = input.routerId.trim();
    const poolId = input.poolId.trim();
    const ip = input.ip.trim();
    const base = { routerId, poolId, ip };

    if (!isValidIpv4(ip)) {
      return {
        ...base,
        status: 'invalid',
        available: false,
        message: 'IP inválida. Escribe una dirección IPv4 válida.',
      };
    }

    const router = this.repository.findRouter(routerId);
    const pool = this.repository.findPool(poolId);
    if (!router || !pool || pool.routerId !== router.id) {
      return {
        ...base,
        status: 'invalid',
        available: false,
        message: 'Selecciona un router y un pool válidos antes de asignar la IP.',
      };
    }

    if (!isIpInCidr(ip, pool.cidr)) {
      return {
        ...base,
        cidr: pool.cidr,
        status: 'out_of_pool',
        available: false,
        message: `IP fuera del segmento ${pool.cidr}.`,
      };
    }

    const parsed = parseCidr(pool.cidr);
    const ipNumber = ipv4ToNumber(ip);
    const reserved = new Set([pool.gateway, ...pool.reservedIps]);
    if (
      reserved.has(ip) ||
      (parsed && ipNumber !== null && (ipNumber === parsed.network || ipNumber === parsed.broadcast))
    ) {
      return {
        ...base,
        cidr: pool.cidr,
        status: 'reserved',
        available: false,
        message: 'IP reservada para infraestructura, gateway o broadcast.',
      };
    }

    const occupied = (await this.occupiedForPool(pool)).find((item) => item.ip === ip);
    if (occupied) {
      return {
        ...base,
        cidr: pool.cidr,
        status: 'in_use',
        available: false,
        usedBy: occupied.label,
        message: `IP ya está en uso por ${occupied.label}.`,
      };
    }

    return {
      ...base,
      cidr: pool.cidr,
      status: 'available',
      available: true,
      message: 'IP disponible.',
    };
  }
}

export const ipamService = new IpamService(
  ipamRepository,
  async () => getCustomersService().list({}),
);
