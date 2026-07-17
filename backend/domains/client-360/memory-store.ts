export interface ClientTag {
  id: string;
  clientId: string;
  tenantId?: string;
  label: string;
  color: string;
  createdAt: string;
}

export interface AlternateContact {
  id: string;
  clientId: string;
  tenantId?: string;
  name?: string;
  phone?: string;
  email?: string;
  channel: 'whatsapp' | 'sms' | 'email' | 'phone';
  isPrimary: boolean;
  createdAt: string;
}

export interface ClientDocument {
  id: string;
  clientId: string;
  tenantId?: string;
  docType: 'ine' | 'contract' | 'receipt' | 'installation_photo' | 'other';
  fileName: string;
  storagePath?: string;
  mimeType?: string;
  uploadedBy?: string;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  clientId: string;
  tenantId?: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  createdAt: string;
}

export const client360Memory = {
  tags: [] as ClientTag[],
  contacts: [] as AlternateContact[],
  documents: [] as ClientDocument[],
  activity: [] as ActivityLogEntry[],
};

export const uid = (p: string) => `${p}-${Date.now()}`;
export const stamp = () => new Date().toISOString();

/** Legacy rows without stamp belong to tenant-default. */
export const matchesTenant = (
  recordTenantId: string | undefined,
  tenantId: string,
): boolean => (recordTenantId || 'tenant-default') === tenantId;
