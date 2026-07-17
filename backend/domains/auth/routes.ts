import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { listRolePermissions } from '../../common/action-permissions';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getWispOnboardingService } from '../wisp-onboarding/service';

const router = Router();

interface UserProfileRow {
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
}

router.get('/api/auth/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'mock-auth-v1' });
});

// Perfil canónico del usuario autenticado. El rol y los datos salen del
// backend (que usa la service-role y bypassa RLS), por lo que NO depende de
// que el navegador pueda leer users_profile (bloqueado por RLS deny-by-default).
router.get('/api/auth/me', asyncHandler(async (req, res) => {
  if (!req.authContext) {
    return res.status(401).json({ error: 'No active auth context' });
  }

  const { userId, role, source, tenantId } = req.authContext;

  let email = '';
  let fullName = '';
  let phone = '';
  let avatarUrl = '';

  if (source === 'supabase-jwt' && isSupabaseAdminConfigured && supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from('users_profile')
      .select('email, full_name, phone, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (data) {
      const profile = data as UserProfileRow;
      email = profile.email || '';
      fullName = profile.full_name || '';
      phone = profile.phone || '';
      avatarUrl = profile.avatar_url || '';
    }
  }

  let onboardingRequired = false;
  let onboardingStep: string | null = null;
  try {
    const onboarding = getWispOnboardingService();
    onboardingRequired = await onboarding.isOnboardingRequired(tenantId);
    if (onboardingRequired) {
      const state = await onboarding.getStatus(tenantId);
      onboardingStep = state?.currentStep ?? 'company';
    }
  } catch {
    // Fail-closed: si no podemos verificar, no saltar el wizard en tenants nuevos.
    onboardingRequired = tenantId !== 'tenant-default';
    onboardingStep = onboardingRequired ? 'company' : null;
  }

  res.json({
    userId,
    email,
    fullName,
    phone,
    avatarUrl,
    role,
    tenantId,
    onboardingRequired,
    onboardingStep,
    permissions: listRolePermissions(role),
    source,
  });
}));

export default router;
