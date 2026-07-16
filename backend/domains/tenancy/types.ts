// ====================================================================
// Tipos del dominio Tenancy (multi-WISP / multi-tenant).
// ====================================================================

export const DEFAULT_TENANT_ID = 'tenant-default';

export type TenantStatus = 'active' | 'suspended' | 'trial';
export type MembershipRole = 'owner' | 'admin' | 'member' | 'readonly';
export type MembershipStatus = 'active' | 'invited' | 'suspended';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  created_at: string | null;
}

export interface TenantMembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateTenantInput {
  id?: string;
  name: string;
  slug: string;
  status?: TenantStatus;
  ownerUserId?: string;
}

export interface CreateMembershipInput {
  id?: string;
  tenantId: string;
  userId: string;
  role?: MembershipRole;
  status?: MembershipStatus;
}

export interface TenancyStatusView {
  mode: 'single-wisp' | 'multi-tenant';
  multiTenantEnabled: boolean;
  defaultTenantId: string;
  note: string;
}
