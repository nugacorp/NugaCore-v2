-- ====================================================================
-- onboarding_status: fail-open -> fail-closed
--
-- `tenants.onboarding_status` nacía con DEFAULT 'completed'. El alta de un WISP
-- inserta el tenant (que quedaba 'completed' por el default) y solo DESPUÉS hace
-- UPDATE ... SET 'in_progress'. Si ese update fallaba, el WISP quedaba 'completed'
-- y SE SALTABA el wizard obligatorio (fail-open).
--
-- Fail-closed: el default pasa a 'in_progress'. Un tenant creado sin fijar el
-- estado explícitamente exige onboarding. El flujo de registro ya fija
-- 'in_progress' explícitamente, así que este cambio solo cierra el hueco cuando
-- ese paso no ocurre.
--
-- Las filas EXISTENTES no se tocan: tenants ya establecidos (incl. tenant-default)
-- conservan su 'completed' y su acceso a consola. tenant-default está además
-- exento por código en WispOnboardingService.isOnboardingRequired().
-- ====================================================================

ALTER TABLE public.tenants
  ALTER COLUMN onboarding_status SET DEFAULT 'in_progress';

COMMENT ON COLUMN public.tenants.onboarding_status IS
  'completed = consola libre; in_progress = wizard WISP obligatorio. '
  'DEFAULT in_progress (fail-closed): un tenant nuevo exige onboarding salvo '
  'que se marque completed explícitamente.';
