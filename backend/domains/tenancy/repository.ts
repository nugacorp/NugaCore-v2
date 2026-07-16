// ====================================================================
// Repository del dominio Tenancy.
//
//   - StoreTenancyRepository    → memoria (tests / demo)
//   - SupabaseTenancyRepository → Postgres (USE_DB_TENANCY / Supabase admin)
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../common/logger';
import { membershipToRow, rowToMembership, rowToTenant, tenantToRow } from './mappers';
import {
  DEFAULT_TENANT_ID,
  type CreateMembershipInput,
  type CreateTenantInput,
  type Tenant,
  type TenantMembership,
  type TenantMembershipRow,
  type TenantRow,
} from './types';

export interface TenancyRepository {
  listTenants(): Promise<Tenant[]>;
  findTenantById(id: string): Promise<Tenant | null>;
  findTenantBySlug(slug: string): Promise<Tenant | null>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  listMembershipsByUser(userId: string): Promise<TenantMembership[]>;
  listMembershipsByTenant(tenantId: string): Promise<TenantMembership[]>;
  findMembership(tenantId: string, userId: string): Promise<TenantMembership | null>;
  createMembership(input: CreateMembershipInput): Promise<TenantMembership>;
  removeMembership(id: string): Promise<boolean>;
}

const DEFAULT_TENANT: Tenant = {
  id: DEFAULT_TENANT_ID,
  name: 'Default WISP',
  slug: 'default',
  status: 'active',
  createdAt: new Date(0).toISOString(),
};

const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// --------------------------------------------------------------------
// Store (memoria)
// --------------------------------------------------------------------
export class StoreTenancyRepository implements TenancyRepository {
  private tenants: Tenant[] = [{ ...DEFAULT_TENANT }];
  private memberships: TenantMembership[] = [];

  async listTenants(): Promise<Tenant[]> {
    return [...this.tenants].sort((a, b) => a.name.localeCompare(b.name));
  }

  async findTenantById(id: string): Promise<Tenant | null> {
    return this.tenants.find((t) => t.id === id) ?? null;
  }

  async findTenantBySlug(slug: string): Promise<Tenant | null> {
    return this.tenants.find((t) => t.slug === slug) ?? null;
  }

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const existing = await this.findTenantBySlug(input.slug);
    if (existing) {
      throw new Error(`Tenant slug already exists: ${input.slug}`);
    }
    const tenant: Tenant = {
      id: input.id || newId('tenant'),
      name: input.name,
      slug: input.slug,
      status: input.status ?? 'active',
      createdAt: new Date().toISOString(),
    };
    this.tenants.push(tenant);
    if (input.ownerUserId) {
      await this.createMembership({
        tenantId: tenant.id,
        userId: input.ownerUserId,
        role: 'owner',
        status: 'active',
      });
    }
    return tenant;
  }

  async listMembershipsByUser(userId: string): Promise<TenantMembership[]> {
    return this.memberships.filter((m) => m.userId === userId && m.status === 'active');
  }

  async listMembershipsByTenant(tenantId: string): Promise<TenantMembership[]> {
    return this.memberships.filter((m) => m.tenantId === tenantId);
  }

  async findMembership(tenantId: string, userId: string): Promise<TenantMembership | null> {
    return (
      this.memberships.find((m) => m.tenantId === tenantId && m.userId === userId) ?? null
    );
  }

  async createMembership(input: CreateMembershipInput): Promise<TenantMembership> {
    const existing = await this.findMembership(input.tenantId, input.userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const membership: TenantMembership = {
      id: input.id || newId('tm'),
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role ?? 'member',
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.memberships.push(membership);
    return membership;
  }

  async removeMembership(id: string): Promise<boolean> {
    const before = this.memberships.length;
    this.memberships = this.memberships.filter((m) => m.id !== id);
    return this.memberships.length < before;
  }

  /** Test helper: reset in-memory state. */
  reset(): void {
    this.tenants = [{ ...DEFAULT_TENANT }];
    this.memberships = [];
  }
}

// --------------------------------------------------------------------
// Supabase
// --------------------------------------------------------------------
const TENANTS_TABLE = 'tenants';
const MEMBERSHIPS_TABLE = 'tenant_memberships';

const fail = (context: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Supabase tenancy repository error: ${context}`, { message });
  throw new Error(`Tenancy DB error (${context}): ${message}`);
};

export class SupabaseTenancyRepository implements TenancyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listTenants(): Promise<Tenant[]> {
    const { data, error } = await this.client.from(TENANTS_TABLE).select('*').order('name');
    if (error) return fail('listTenants', error);
    const rows = (data as TenantRow[] | null) ?? [];
    if (rows.length === 0) return [{ ...DEFAULT_TENANT }];
    return rows.map(rowToTenant);
  }

  async findTenantById(id: string): Promise<Tenant | null> {
    const { data, error } = await this.client
      .from(TENANTS_TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return fail('findTenantById', error);
    return data ? rowToTenant(data as TenantRow) : null;
  }

  async findTenantBySlug(slug: string): Promise<Tenant | null> {
    const { data, error } = await this.client
      .from(TENANTS_TABLE)
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (error) return fail('findTenantBySlug', error);
    return data ? rowToTenant(data as TenantRow) : null;
  }

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const tenant: Tenant = {
      id: input.id || newId('tenant'),
      name: input.name,
      slug: input.slug,
      status: input.status ?? 'active',
      createdAt: new Date().toISOString(),
    };
    const { data, error } = await this.client
      .from(TENANTS_TABLE)
      .insert(tenantToRow(tenant))
      .select('*')
      .single();
    if (error) return fail('createTenant', error);
    const created = rowToTenant(data as TenantRow);
    if (input.ownerUserId) {
      await this.createMembership({
        tenantId: created.id,
        userId: input.ownerUserId,
        role: 'owner',
        status: 'active',
      });
    }
    return created;
  }

  async listMembershipsByUser(userId: string): Promise<TenantMembership[]> {
    const { data, error } = await this.client
      .from(MEMBERSHIPS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) return fail('listMembershipsByUser', error);
    return ((data as TenantMembershipRow[] | null) ?? []).map(rowToMembership);
  }

  async listMembershipsByTenant(tenantId: string): Promise<TenantMembership[]> {
    const { data, error } = await this.client
      .from(MEMBERSHIPS_TABLE)
      .select('*')
      .eq('tenant_id', tenantId);
    if (error) return fail('listMembershipsByTenant', error);
    return ((data as TenantMembershipRow[] | null) ?? []).map(rowToMembership);
  }

  async findMembership(tenantId: string, userId: string): Promise<TenantMembership | null> {
    const { data, error } = await this.client
      .from(MEMBERSHIPS_TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return fail('findMembership', error);
    return data ? rowToMembership(data as TenantMembershipRow) : null;
  }

  async createMembership(input: CreateMembershipInput): Promise<TenantMembership> {
    const existing = await this.findMembership(input.tenantId, input.userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const membership: TenantMembership = {
      id: input.id || newId('tm'),
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role ?? 'member',
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    const { data, error } = await this.client
      .from(MEMBERSHIPS_TABLE)
      .insert(membershipToRow(membership))
      .select('*')
      .single();
    if (error) return fail('createMembership', error);
    return rowToMembership(data as TenantMembershipRow);
  }

  async removeMembership(id: string): Promise<boolean> {
    const { error } = await this.client.from(MEMBERSHIPS_TABLE).delete().eq('id', id);
    if (error) return fail('removeMembership', error);
    return true;
  }
}
