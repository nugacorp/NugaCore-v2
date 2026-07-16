import {
  SESSION_ACCESS_TOKEN_STORAGE_KEY,
  SESSION_PROFILE_STORAGE_KEY,
  UserSessionProfile,
  normalizeUserRole,
  supabase,
} from './supabase';

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const authSession = {
  readProfile(): UserSessionProfile | null {
    return safeParse<UserSessionProfile>(localStorage.getItem(SESSION_PROFILE_STORAGE_KEY));
  },

  readAccessToken(): string {
    return localStorage.getItem(SESSION_ACCESS_TOKEN_STORAGE_KEY) || '';
  },

  save(profile: UserSessionProfile, accessToken?: string): void {
    localStorage.setItem(SESSION_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    if (accessToken) {
      localStorage.setItem(SESSION_ACCESS_TOKEN_STORAGE_KEY, accessToken);
    }
  },

  clear(): void {
    localStorage.removeItem(SESSION_PROFILE_STORAGE_KEY);
    localStorage.removeItem(SESSION_ACCESS_TOKEN_STORAGE_KEY);
  },
};

// ====================================================================
// Perfil CANÓNICO desde el backend (/api/auth/me).
//
// El rol y los datos del usuario salen del backend (service-role, bypassa
// RLS). NO se consulta users_profile directamente desde el navegador porque
// la RLS deny-by-default lo bloquea y haría caer a todos al rol por defecto.
// ====================================================================
interface AuthMeResponse {
  userId: string;
  email?: string;
  fullName?: string;
  phone?: string;
  avatarUrl?: string;
  role?: string;
  tenantId?: string;
  onboardingRequired?: boolean;
  onboardingStep?: string;
  permissions?: string[];
  source?: 'supabase-jwt' | 'trusted-headers';
}

export async function fetchProfileFromBackend(accessToken: string): Promise<UserSessionProfile | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const me = (await res.json()) as AuthMeResponse;
    return {
      id: me.userId,
      email: me.email || '',
      full_name: me.fullName || 'Usuario Autenticado',
      phone: me.phone || '',
      role: normalizeUserRole(me.role),
      avatar_url: me.avatarUrl || '',
      tenantId: me.tenantId,
      onboardingRequired: Boolean(me.onboardingRequired),
      onboardingStep: me.onboardingStep,
      source: me.source,
      permissions: me.permissions || [],
    };
  } catch {
    return null;
  }
}

/**
 * Recupera la sesión de Supabase y reconstruye el perfil desde /api/auth/me.
 * Devuelve null si no hay sesión válida o el backend no responde el perfil.
 */
export async function restoreSessionProfileFromSupabase(): Promise<UserSessionProfile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    return null;
  }

  const profile = await fetchProfileFromBackend(accessToken);
  if (!profile) return null;

  authSession.save(profile, accessToken);
  return profile;
}
