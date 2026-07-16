import type {
  MembershipRole,
  MembershipStatus,
  Tenant,
  TenantMembership,
  TenantMembershipRow,
  TenantRow,
  TenantStatus,
} from './types';

const asTenantStatus = (value: string | null | undefined): TenantStatus => {
  if (value === 'suspended' || value === 'trial') return value;
  return 'active';
};

const asMembershipRole = (value: string | null | undefined): MembershipRole => {
  if (value === 'owner' || value === 'admin' || value === 'readonly') return value;
  return 'member';
};

const asMembershipStatus = (value: string | null | undefined): MembershipStatus => {
  if (value === 'invited' || value === 'suspended') return value;
  return 'active';
};

export const rowToTenant = (row: TenantRow): Tenant => ({
  id: String(row.id),
  name: String(row.name),
  slug: String(row.slug),
  status: asTenantStatus(row.status),
  createdAt: String(row.created_at ?? new Date().toISOString()),
});

export const tenantToRow = (tenant: Tenant): TenantRow => ({
  id: tenant.id,
  name: tenant.name,
  slug: tenant.slug,
  status: tenant.status,
  created_at: tenant.createdAt,
});

export const rowToMembership = (row: TenantMembershipRow): TenantMembership => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  userId: String(row.user_id),
  role: asMembershipRole(row.role),
  status: asMembershipStatus(row.status),
  createdAt: String(row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updated_at ?? new Date().toISOString()),
});

export const membershipToRow = (m: TenantMembership): TenantMembershipRow => ({
  id: m.id,
  tenant_id: m.tenantId,
  user_id: m.userId,
  role: m.role,
  status: m.status,
  created_at: m.createdAt,
  updated_at: m.updatedAt,
});
