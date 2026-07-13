import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

const isConfigured = env.SUPABASE_URL.trim() !== '' && env.SUPABASE_SERVICE_ROLE_KEY.trim() !== '';

export const supabaseAdmin = isConfigured
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

export const isSupabaseAdminConfigured = isConfigured;

/** Ping ligero a PostgREST para readiness (no expone datos). */
export async function pingSupabase(): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { error } = await supabaseAdmin.from('clients').select('id', { head: true, count: 'exact' });
  return !error;
}
