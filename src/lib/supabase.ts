import { createClient } from '@supabase/supabase-js';

// Load values from Vite client environment variables
const viteEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey =
  viteEnv.VITE_SUPABASE_ANON_KEY
  || viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY
  || '';

// Lazy initialization check
export const isSupabaseConfigured = supabaseUrl.trim() !== '' && supabaseAnonKey.trim() !== '';

// Create client only if environment variables are set to prevent early startup crashes
export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

export const supabaseConfig = {
  url: supabaseUrl,
  hasAnonKey: supabaseAnonKey.trim() !== '',
  isConfigured: isSupabaseConfigured,
} as const;

export interface UserSessionProfile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: 'Super Admin' | 'Administrador' | 'Cobranza' | 'Técnico' | 'Soporte' | 'Solo lectura';
  avatar_url?: string;
  /** Origen de la identidad verificada por el backend. */
  source?: 'supabase-jwt' | 'trusted-headers';
  /** Acciones permitidas para el rol (desde /api/auth/me). */
  permissions?: string[];
}

export type UserRole = UserSessionProfile['role'];

export const SESSION_PROFILE_STORAGE_KEY = 'nugacore_user_profile';
export const SESSION_ACCESS_TOKEN_STORAGE_KEY = 'nugacore_access_token';

export function normalizeUserRole(value: string | null | undefined): UserRole {
  const role = (value || '').trim().toLowerCase();
  if (role === 'super admin' || role === 'superadmin') return 'Super Admin';
  if (role === 'administrador' || role === 'admin') return 'Administrador';
  if (role === 'cobranza') return 'Cobranza';
  if (role === 'tecnico' || role === 'técnico') return 'Técnico';
  if (role === 'soporte') return 'Soporte';
  return 'Solo lectura';
}

// ====================================================================
// Quick-login de STAGING (Fase 4.3.1 hardening).
//
// Solo PRE-RELLENA el email de los usuarios de staging para acelerar la
// validación de Hermes. NO contiene passwords, NI tokens, NI perfiles
// embebidos: la autenticación real ocurre vía Supabase con la contraseña
// que el operador teclea (el password de staging vive root-only, ver
// docs/STAGING_AUTH_USERS.md).
//
// Gateado por VITE_ENABLE_QUICK_LOGIN: apagado por defecto, de modo que el
// bundle de PRODUCCIÓN no muestra ningún acceso rápido.
// ====================================================================
export interface QuickLoginEntry {
  role: UserRole;
  email: string;
  label: string;
}

export const STAGING_QUICK_LOGINS: QuickLoginEntry[] = [
  { role: 'Super Admin', email: 'superadmin@staging.nugacore.local', label: 'Super Admin' },
  { role: 'Administrador', email: 'admin@staging.nugacore.local', label: 'Administrador' },
  { role: 'Cobranza', email: 'billing@staging.nugacore.local', label: 'Cobranza' },
  { role: 'Técnico', email: 'tech@staging.nugacore.local', label: 'Técnico' },
  { role: 'Soporte', email: 'support@staging.nugacore.local', label: 'Soporte' },
  { role: 'Solo lectura', email: 'readonly@staging.nugacore.local', label: 'Solo lectura' },
];

/**
 * ¿Mostrar el panel de quick-login (prefill de email)? Apagado por defecto.
 * Habilitar SOLO en staging con `VITE_ENABLE_QUICK_LOGIN=true` en build-time.
 */
export const isQuickLoginEnabled = (viteEnv.VITE_ENABLE_QUICK_LOGIN || '').trim() === 'true';
