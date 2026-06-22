import type { Client } from '../../../src/types';
import { getCustomersService } from '../customers/service';
import { ipamViewSource, toPoolView, toRouterView } from './mappers';
import {
  mockIpamProvider,
  readIpamWithFallback,
  resolveIpamProvider,
  type IpamProvider,
} from './providers';
import type {
  AvailableIpsResult,
  IpValidationInput,
  IpValidationResult,
  IpamCapacityResult,
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
    private readonly primary: IpamProvider,
    private readonly fallback: IpamProvider = mockIpamProvider,
    private readonly assignedClientsProvider: AssignedClientsProvider = async () => [],
  ) {}

  private read<T>(read: (provider: IpamProvider) => Promise<T>) {
    return readIpamWithFallback(this.primary, this.fallback, read);
  }

  async listRouters() {
    const result = await this.read((provider) => provider.listRouters());
    return result.data.map((router) => toRouterView(router, result.source));
  }

  async getRouter(routerId: string) {
    const result = await this.read((provider) => provider.findRouter(routerId));
    return result.data ? toRouterView(result.data, result.source) : null;
  }

  async listPools(routerId: string) {
    const result = await this.read(async (provider) => {
      const router = await provider.findRouter(routerId);
      return router ? provider.listPools(routerId) : null;
    });
    return result.data?.map((pool) => toPoolView(pool, result.source)) ?? null;
  }

  private async findPool(poolId: string) {
    return this.read((provider) => provider.findPool(poolId));
  }

  private async occupiedForPool(pool: IpamPool): Promise<IpamOccupiedAddress[]> {
    const result = await this.read((provider) => provider.listOccupied(pool.id));
    const occupied = result.data;
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

  async capacity(routerId: string): Promise<IpamCapacityResult | null> {
    const result = await this.read(async (provider) => {
      const [router, seed] = await Promise.all([
        provider.findRouter(routerId),
        provider.getCapacity(routerId),
      ]);
      return router && seed ? { router, seed } : null;
    });
    if (!result.data) return null;

    const clients = await this.assignedClientsProvider();
    const assignedActive = clients.filter(
      (client) => client.status === 'active' && client.routerId === routerId,
    ).length;
    const activeClients = Math.min(
      result.data.seed.totalCapacity,
      result.data.seed.baselineActiveClients + assignedActive,
    );
    const freeCapacity = Math.max(0, result.data.seed.totalCapacity - activeClients);

    return {
      routerId,
      routerName: result.data.router.name,
      totalCapacity: result.data.seed.totalCapacity,
      activeClients,
      freeCapacity,
      utilizationPercent: Number(
        ((activeClients / Math.max(1, result.data.seed.totalCapacity)) * 100).toFixed(2),
      ),
    };
  }

  async availableIps(poolId: string): Promise<AvailableIpsResult | null> {
    const poolResult = await this.findPool(poolId);
    const pool = poolResult.data;
    if (!pool) return null;

    const cidr = parseCidr(pool.cidr);
    if (!cidr || cidr.prefix > 30) {
      return {
        routerId: pool.routerId,
        poolId: pool.id,
        cidr: pool.cidr,
        totalAvailable: 0,
        ips: [],
        source: ipamViewSource(poolResult.source),
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
      source: ipamViewSource(poolResult.source),
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

    const result = await this.read(async (provider) => ({
      router: await provider.findRouter(routerId),
      pool: await provider.findPool(poolId),
    }));
    const { router, pool } = result.data;
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
  resolveIpamProvider(),
  mockIpamProvider,
  async () => getCustomersService().list({}),
);
