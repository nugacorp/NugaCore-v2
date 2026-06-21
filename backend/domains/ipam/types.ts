export type IpamRouterKind = 'router' | 'tower';

export interface IpamRouter {
  id: string;
  name: string;
  kind: IpamRouterKind;
  description: string;
}

export interface IpamPool {
  id: string;
  routerId: string;
  name: string;
  cidr: string;
  gateway: string;
  reservedIps: string[];
}

export interface IpamOccupiedAddress {
  ip: string;
  label: string;
  source: 'mock' | 'customer';
}

export type IpValidationStatus = 'available' | 'in_use' | 'reserved' | 'invalid' | 'out_of_pool';

export interface IpValidationInput {
  routerId: string;
  poolId: string;
  ip: string;
}

export interface IpValidationResult {
  routerId: string;
  poolId: string;
  ip: string;
  status: IpValidationStatus;
  available: boolean;
  message: string;
  cidr?: string;
  usedBy?: string;
}

export interface AvailableIpsResult {
  routerId: string;
  poolId: string;
  cidr: string;
  totalAvailable: number;
  ips: string[];
  source: 'mock-local';
}
