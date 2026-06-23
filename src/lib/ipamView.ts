export type IpAssignmentUiStatus =
  | 'available'
  | 'in_use'
  | 'reserved'
  | 'invalid'
  | 'out_of_pool';

export interface IpAssignmentValidation {
  routerId: string;
  poolId: string;
  ip: string;
  status: IpAssignmentUiStatus;
  available: boolean;
  message: string;
  cidr?: string;
  usedBy?: string;
}

export const isValidIpv4Input = (value: string): boolean => {
  const parts = value.trim().split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
};

export const isNetworkAssignmentRequired = (isLead: boolean): boolean => !isLead;

export const canSubmitCustomerOnboarding = (input: {
  name: string;
  type: string;
  address: string;
  city: string;
  isLead: boolean;
  routerId: string;
  poolId: string;
  assignedIp: string;
  validation: IpAssignmentValidation | null;
}): boolean => {
  // Mantener sincronizado con la validación del backend de /api/clients.
  // Evita enviar formularios incompletos que terminan en 400 en consola.
  if (!input.name.trim() || !input.type.trim() || !input.address.trim() || !input.city.trim()) return false;
  if (!isNetworkAssignmentRequired(input.isLead)) return true;
  return Boolean(
    input.routerId &&
    input.poolId &&
    input.assignedIp &&
    input.validation?.available &&
    input.validation.status === 'available' &&
    input.validation.ip === input.assignedIp.trim(),
  );
};

export const ipStatusLabel = (status: IpAssignmentUiStatus | null): string => {
  switch (status) {
    case 'available':
      return 'Disponible';
    case 'in_use':
      return 'En uso';
    case 'reserved':
      return 'Reservada';
    case 'out_of_pool':
    case 'invalid':
      return 'Inválida';
    default:
      return 'Sin validar';
  }
};

export const ipStatusMessage = (validation: IpAssignmentValidation | null): string => {
  if (validation?.message) return validation.message;
  switch (validation?.status) {
    case 'available':
      return 'IP disponible.';
    case 'in_use':
      return 'IP ya está en uso por otro cliente/equipo.';
    case 'reserved':
      return 'IP reservada para infraestructura.';
    case 'out_of_pool':
      return 'IP fuera del segmento.';
    case 'invalid':
      return 'IP inválida.';
    default:
      return '';
  }
};
