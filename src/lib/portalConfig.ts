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

export const DEFAULT_PORTAL_FEATURES: PortalFeatures = {
  balance: true,
  reportFailure: true,
  invoices: true,
  tickets: true,
  paymentPromise: true,
};

export interface PortalConfigResponse {
  tenantId: string;
  features: PortalFeatures;
  updatedAt?: string;
}

export const PORTAL_FEATURE_LABELS: Record<PortalFeatureKey, { title: string; description: string }> = {
  balance: {
    title: 'Saldo y vencimiento',
    description: 'Muestra el saldo pendiente y la fecha del próximo vencimiento.',
  },
  reportFailure: {
    title: 'Reportar falla',
    description: 'Permite al abonado abrir un ticket de falla desde el portal.',
  },
  invoices: {
    title: 'Mis facturas',
    description: 'Lista las facturas del cliente con montos y estatus.',
  },
  tickets: {
    title: 'Mis tickets',
    description: 'Muestra los tickets de soporte del abonado.',
  },
  paymentPromise: {
    title: 'Promesa de pago',
    description: 'Permite solicitar una promesa de pago con fecha y monto.',
  },
};

export const PORTAL_FEATURE_ORDER: PortalFeatureKey[] = [
  'balance',
  'reportFailure',
  'invoices',
  'tickets',
  'paymentPromise',
];
