import { createClient } from '@supabase/supabase-js';

// Load values from Vite client environment variables
const viteEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || '';

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

// Default mock profiles for local staging or preview mode
export const MOCK_USER_PROFILES: UserSessionProfile[] = [
  {
    id: 'f72da078-4eb2-43bb-a5a4-ba09fd268bf1',
    email: 'admin@nugacorp.com',
    full_name: 'Ing. Rodrigo Nuga',
    phone: '+52 55 1234 5678',
    role: 'Super Admin',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'
  },
  {
    id: 'f72da078-4eb2-43bb-a5a4-ba09fd268bf2',
    email: 'cobranza@nugacorp.com',
    full_name: 'María Luisa Rojas',
    phone: '+52 55 8765 4321',
    role: 'Cobranza',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80'
  },
  {
    id: 'f72da078-4eb2-43bb-a5a4-ba09fd268bf3',
    email: 'tecnico@nugacorp.com',
    full_name: 'Carlos Mendoza',
    phone: '+52 55 5555 1234',
    role: 'Técnico',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80'
  },
  {
    id: 'f72da078-4eb2-43bb-a5a4-ba09fd268bf4',
    email: 'soporte@nugacorp.com',
    full_name: 'Sofía Valenzuela',
    phone: '+52 55 9999 8888',
    role: 'Soporte',
    avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&q=80'
  }
];
