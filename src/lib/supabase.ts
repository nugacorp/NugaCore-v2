import { createClient } from '@supabase/supabase-js';
import { readRuntimeConfig } from '../config/runtimeConfig';

// ── Configuración pública: runtime primero, build-time como respaldo ──
//
// El servidor sirve `/runtime-config.js` antes que el bundle, así que una
// misma imagen OCI puede promoverse entre ambientes cambiando sólo variables
// del contenedor. Las `VITE_*` siguen funcionando para desarrollo local y
// para cualquier build antigua que aún las traiga incrustadas.
//
// Si no hay ninguna de las dos, el comportamiento no cambia: cliente nulo y
// fail-closed, igual que antes.
const runtimeConfig = readRuntimeConfig();
const viteEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

const supabaseUrl =
  runtimeConfig?.SUPABASE_URL
  || viteEnv.VITE_SUPABASE_URL
  || '';
const supabaseAnonKey =
  runtimeConfig?.SUPABASE_ANON_KEY
  || viteEnv.VITE_SUPABASE_ANON_KEY
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
  /** Tenant WISP activo (aislado). */
  tenantId?: string;
  /** Wizard WISP obligatorio pendiente. */
  onboardingRequired?: boolean;
  onboardingStep?: string;
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

// Quick-login de staging eliminado: login profesional multi-tenant (correo + contraseña).
