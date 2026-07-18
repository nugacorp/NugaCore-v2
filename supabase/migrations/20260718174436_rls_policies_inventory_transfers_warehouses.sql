-- Add service_role-only RLS policies for inventory transfer tables flagged by Supabase advisor.
-- RLS is already enabled; these policies keep direct client access closed while allowing the backend service_role.

DO $$
BEGIN
  IF to_regclass('public.warehouses') IS NOT NULL THEN
    ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'warehouses'
        AND policyname = 'warehouses_service_role'
    ) THEN
      CREATE POLICY warehouses_service_role ON public.warehouses
        FOR ALL
        USING ((select auth.role()) = 'service_role')
        WITH CHECK ((select auth.role()) = 'service_role');
    END IF;
  END IF;

  IF to_regclass('public.inventory_transfers') IS NOT NULL THEN
    ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'inventory_transfers'
        AND policyname = 'inventory_transfers_service_role'
    ) THEN
      CREATE POLICY inventory_transfers_service_role ON public.inventory_transfers
        FOR ALL
        USING ((select auth.role()) = 'service_role')
        WITH CHECK ((select auth.role()) = 'service_role');
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
