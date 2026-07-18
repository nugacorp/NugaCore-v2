export type PortalFeatureKey =
  | 'balance'
  | 'reportFailure'
  | 'invoices'
  | 'tickets'
  | 'paymentPromise';

export interface PortalFeatures {
  balance: boolean;
  reportFailure: boolean;
  invoices: boolean;
  tickets: boolean;
  paymentPromise: boolean;
}

export const PORTAL_FEATURE_KEYS: PortalFeatureKey[] = [
  'balance',
  'reportFailure',
  'invoices',
  'tickets',
  'paymentPromise',
];

export const DEFAULT_PORTAL_FEATURES: PortalFeatures = {
  balance: true,
  reportFailure: true,
  invoices: true,
  tickets: true,
  paymentPromise: true,
};

export interface PortalConfig {
  tenantId: string;
  features: PortalFeatures;
  updatedAt: string;
}

export type PortalFeaturesPatch = Partial<PortalFeatures>;
