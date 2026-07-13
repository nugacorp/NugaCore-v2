-- ====================================================================
-- Fix Supabase linter 0011: function_search_path_mutable
-- Fija search_path en update_modified_column() (trigger updated_at).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_modified_column() IS
  'Trigger: asigna updated_at = now(). search_path fijo (linter 0011).';
