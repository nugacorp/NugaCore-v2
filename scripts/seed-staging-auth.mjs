// ====================================================================
// Seed de usuarios de AUTH para STAGING (Fase 2).
//
// Crea usuarios FICTICIOS en Supabase Auth (uno por rol), su users_profile
// y su user_roles. Idempotente. Usa la SERVICE-ROLE key (lado servidor),
// NUNCA el PAT. El password se lee de STAGING_AUTH_PASSWORD (no hardcodeado).
//
// Uso:
//   1) En .env (gitignored): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAGING_AUTH_PASSWORD
//   2) node --env-file=.env scripts/seed-staging-auth.mjs
//      (o: node scripts/seed-staging-auth.mjs  si exportas las vars)
//
// ⚠️ Solo datos ficticios de staging. No clientes ni usuarios reales.
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.STAGING_AUTH_PASSWORD;

if (!url || !serviceKey) {
  console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}
if (!password) {
  console.error('Falta STAGING_AUTH_PASSWORD en el entorno (define un password ficticio para los usuarios de staging).');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Usuarios ficticios, uno por rol (nombres de rol deben existir en public.roles).
const USERS = [
  { email: 'superadmin@nugacore.local', full_name: 'Staging Super Admin', role: 'Super Admin' },
  { email: 'admin@nugacore.local',      full_name: 'Staging Administrador', role: 'Administrador' },
  { email: 'cobranza@nugacore.local',   full_name: 'Staging Cobranza',     role: 'Cobranza' },
  { email: 'tecnico@nugacore.local',    full_name: 'Staging Técnico',      role: 'Técnico' },
  { email: 'soporte@nugacore.local',    full_name: 'Staging Soporte',      role: 'Soporte' },
  { email: 'lectura@nugacore.local',    full_name: 'Staging Solo Lectura', role: 'Solo lectura' },
];

const findUserIdByEmail = async (email) => {
  // Pagina hasta encontrar el email (suficiente para staging).
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
};

const ensureUser = async (email) => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error && data?.user) return { id: data.user.id, created: true };

  // Ya existe (o error de duplicado) -> buscar su id
  const existingId = await findUserIdByEmail(email);
  if (existingId) return { id: existingId, created: false };
  throw error || new Error(`No se pudo crear ni encontrar el usuario ${email}`);
};

const run = async () => {
  // Mapa nombre de rol -> id
  const { data: roles, error: rolesErr } = await admin.from('roles').select('id, name');
  if (rolesErr) throw rolesErr;
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

  for (const u of USERS) {
    const roleId = roleIdByName.get(u.role);
    if (!roleId) {
      console.error(`Rol no encontrado en public.roles: ${u.role} (¿aplicaste las migraciones/seeds?)`);
      continue;
    }
    const { id, created } = await ensureUser(u.email);

    const { error: profErr } = await admin
      .from('users_profile')
      .upsert({ id, email: u.email, full_name: u.full_name }, { onConflict: 'id' });
    if (profErr) throw profErr;

    const { error: roleErr } = await admin
      .from('user_roles')
      .upsert({ user_id: id, role_id: roleId }, { onConflict: 'user_id,role_id', ignoreDuplicates: true });
    if (roleErr) throw roleErr;

    console.log(`${created ? 'creado ' : 'existe '} ${u.email.padEnd(28)} -> ${u.role}`);
  }
  console.log('Seed de auth (staging) completado. Password: (definido por STAGING_AUTH_PASSWORD, no impreso).');
};

run().catch((err) => {
  console.error('Seed de auth falló:', err.message || err);
  process.exit(1);
});
