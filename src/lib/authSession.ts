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
  let backendRole: string | null = null;
  try {
    const authMe = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (authMe.ok) {
      const authContext = await authMe.json();
      backendRole = typeof authContext.role === 'string' ? authContext.role : null;
    }
  } catch {
    backendRole = null;
  }

  const userProfile: UserSessionProfile = {
    id: sessionUser.id,
    email: (sessionUser.email || '').trim(),
    full_name: (sessionUser.user_metadata?.full_name as string | undefined) || 'Usuario Autenticado',
    phone: (sessionUser.user_metadata?.phone as string | undefined) || '',
    role: normalizeUserRole(backendRole),
    avatar_url: (sessionUser.user_metadata?.avatar_url as string | undefined) || '',
  };

  authSession.save(userProfile, data.session.access_token);
  return userProfile;
}
