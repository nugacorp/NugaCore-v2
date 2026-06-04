import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { listRolePermissions } from '../../common/action-permissions';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';

const router = Router();

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

  const { userId, role, source } = req.authContext;

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
      email = (data as any).email || '';
      fullName = (data as any).full_name || '';
      phone = (data as any).phone || '';
      avatarUrl = (data as any).avatar_url || '';
    }
  }

  res.json({
    userId,
    email,
    fullName,
    phone,
    avatarUrl,
    role,
    permissions: listRolePermissions(role),
    source,
  });
}));

export default router;
