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

export async function restoreSessionProfileFromSupabase(): Promise<UserSessionProfile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) {
    return null;
  }

  const sessionUser = data.session.user;
  const { data: profile } = await supabase
    .from('users_profile')
    .select(`
      id,
      email,
      full_name,
      phone,
      avatar_url,
      user_roles (
        roles (
          name
        )
      )
    `)
    .eq('id', sessionUser.id)
    .maybeSingle();

  const userRoles = (profile as { user_roles?: Array<{ roles?: { name?: string } }> } | null)?.user_roles;
  const rawRole = Array.isArray(userRoles) && userRoles.length > 0
    ? userRoles[0]?.roles?.name || null
    : null;

  const userProfile: UserSessionProfile = {
    id: sessionUser.id,
    email: (profile?.email || sessionUser.email || '').trim(),
    full_name: profile?.full_name || 'Usuario Autenticado',
    phone: profile?.phone || '',
    role: normalizeUserRole(rawRole),
    avatar_url: profile?.avatar_url || '',
  };

  authSession.save(userProfile, data.session.access_token);
  return userProfile;
}
