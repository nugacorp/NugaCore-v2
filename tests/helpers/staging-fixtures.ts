import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

export type StagingRoleKey =
  | 'superadmin'
  | 'administrador'
  | 'cobranza'
  | 'tecnico'
  | 'soporte'
  | 'readonly';

type RoleFixture = {
  email: string;
  fullName: string;
  displayRole: string;
  expectedRole: string;
};

const roleFixtures: Record<StagingRoleKey, Omit<RoleFixture, 'email'>> = {
  superadmin: {
    fullName: 'Auth Test Super Admin',
    displayRole: 'Super Admin',
    expectedRole: 'super admin',
  },
  administrador: {
    fullName: 'Auth Test Administrador',
    displayRole: 'Administrador',
    expectedRole: 'administrador',
  },
  cobranza: {
    fullName: 'Auth Test Cobranza',
    displayRole: 'Cobranza',
    expectedRole: 'cobranza',
  },
  tecnico: {
    fullName: 'Auth Test Tecnico',
    displayRole: 'Tecnico',
    expectedRole: 'tecnico',
  },
  soporte: {
    fullName: 'Auth Test Soporte',
    displayRole: 'Soporte',
    expectedRole: 'soporte',
  },
  readonly: {
    fullName: 'Auth Test Solo Lectura',
    displayRole: 'Solo lectura',
    expectedRole: 'solo lectura',
  },
};

const canonicalRoleName = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export const STAGING_DB_TEST_USERS = {
  inventoryAdmin: '00000000-0000-4000-8000-000000000101',
  enrollmentAdmin: '00000000-0000-4000-8000-000000000102',
} as const;

export const stagingDbAdminHeaders = (userId: string): Record<string, string> => ({
  'x-user-role': 'super admin',
  'x-user-id': userId,
  'x-tenant-id': DEFAULT_TENANT_ID,
});

const assertSupabaseOk = (action: string, error: unknown): void => {
  if (!error) return;
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  throw new Error(`${action}: ${message}`);
};

export const ensureStagingTenantMemberships = async (
  admin: SupabaseClient,
  userIds: string[],
): Promise<string[]> => {
  const tenant = await admin.from('tenants').upsert({
    id: DEFAULT_TENANT_ID,
    name: 'Default WISP',
    slug: 'default',
    status: 'active',
  }, { onConflict: 'id' });
  assertSupabaseOk('ensure default tenant', tenant.error);

  if (!userIds.length) return [];

  const now = new Date().toISOString();
  const rows = userIds.map((userId) => ({
    id: `tm-test-${userId}`,
    tenant_id: DEFAULT_TENANT_ID,
    user_id: userId,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  }));

  const memberships = await admin
    .from('tenant_memberships')
    .upsert(rows, { onConflict: 'tenant_id,user_id' });
  assertSupabaseOk('ensure tenant memberships', memberships.error);
  return rows.map((row) => row.id);
};

export const cleanupStagingTenantMemberships = async (
  admin: SupabaseClient,
  membershipIds: string[],
): Promise<void> => {
  if (!membershipIds.length) return;
  const result = await admin.from('tenant_memberships').delete().in('id', membershipIds);
  assertSupabaseOk('cleanup tenant memberships', result.error);
};

export const ensureStagingWarehouses = async (
  admin: SupabaseClient,
  names: string[],
): Promise<string[]> => {
  if (!names.length) return [];
  const now = new Date().toISOString();
  const createdIds: string[] = [];
  for (const name of names) {
    const existing = await admin
      .from('warehouses')
      .select('id')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('name', name)
      .limit(1)
      .maybeSingle();
    assertSupabaseOk('lookup staging warehouse', existing.error);
    if (existing.data) continue;

    const id = `wh-test-${canonicalRoleName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const inserted = await admin.from('warehouses').insert({
      id,
      tenant_id: DEFAULT_TENANT_ID,
      name,
      type: name === 'Principal' ? 'principal' : 'tecnico',
      is_active: true,
      created_at: now,
      updated_at: now,
    });
    assertSupabaseOk('ensure staging warehouse', inserted.error);
    createdIds.push(id);
  }
  return createdIds;
};

export const cleanupStagingWarehouses = async (
  admin: SupabaseClient,
  warehouseIds: string[],
): Promise<void> => {
  if (!warehouseIds.length) return;
  const result = await admin.from('warehouses').delete().in('id', warehouseIds);
  assertSupabaseOk('cleanup staging warehouses', result.error);
};

export const createStagingAuthFixtures = async (
  admin: SupabaseClient,
  password: string,
): Promise<{
  users: Record<StagingRoleKey, { email: string; expectedRole: string }>;
  cleanup: () => Promise<void>;
}> => {
  const runId = randomUUID().replace(/-/g, '');
  const { data: roles, error: rolesError } = await admin.from('roles').select('id, name');
  assertSupabaseOk('load roles', rolesError);

  const roleIdByName = new Map(
    ((roles as Array<{ id: string; name: string }> | null) ?? []).map((role) => [
      canonicalRoleName(role.name),
      role.id,
    ]),
  );
  const createdUserIds: string[] = [];
  const membershipIds: string[] = [];
  const users = {} as Record<StagingRoleKey, { email: string; expectedRole: string }>;

  await ensureStagingTenantMemberships(admin, []);

  for (const [key, fixture] of Object.entries(roleFixtures) as Array<[StagingRoleKey, Omit<RoleFixture, 'email'>]>) {
    const roleId = roleIdByName.get(canonicalRoleName(fixture.displayRole));
    if (!roleId) throw new Error(`Role fixture missing in DB: ${fixture.displayRole}`);

    const email = `nugacore-auth-${runId}-${key}@staging.nugacore.local`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        tenant_id: DEFAULT_TENANT_ID,
        nugacore_fixture: 'auth-contract',
        fixture_run_id: runId,
      },
    });
    assertSupabaseOk(`create auth fixture ${key}`, created.error);
    const userId = created.data.user?.id;
    if (!userId) throw new Error(`Auth fixture ${key} did not return a user id`);
    createdUserIds.push(userId);

    const profile = await admin.from('users_profile').upsert({
      id: userId,
      email,
      full_name: fixture.fullName,
      status: 'active',
    }, { onConflict: 'id' });
    assertSupabaseOk(`upsert profile fixture ${key}`, profile.error);

    const userRole = await admin
      .from('user_roles')
      .upsert({ user_id: userId, role_id: roleId }, { onConflict: 'user_id,role_id' });
    assertSupabaseOk(`upsert role fixture ${key}`, userRole.error);

    const membershipId = `tm-auth-${runId}-${key}`;
    const membership = await admin.from('tenant_memberships').upsert({
      id: membershipId,
      tenant_id: DEFAULT_TENANT_ID,
      user_id: userId,
      role: key === 'readonly' ? 'readonly' : key === 'superadmin' ? 'owner' : 'member',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,user_id' });
    assertSupabaseOk(`upsert membership fixture ${key}`, membership.error);
    membershipIds.push(membershipId);
    users[key] = { email, expectedRole: fixture.expectedRole };
  }

  return {
    users,
    cleanup: async () => {
      await cleanupStagingTenantMemberships(admin, membershipIds);
      if (createdUserIds.length) {
        await admin.from('user_roles').delete().in('user_id', createdUserIds);
        await admin.from('users_profile').delete().in('id', createdUserIds);
      }
      for (const userId of createdUserIds) {
        const deleted = await admin.auth.admin.deleteUser(userId);
        assertSupabaseOk('delete auth fixture', deleted.error);
      }
    },
  };
};
