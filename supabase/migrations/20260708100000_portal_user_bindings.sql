-- Portal cliente: vincula usuarios Supabase Auth con un cliente CRM.
-- Producción: un usuario portal solo accede a su client_id.

CREATE TABLE IF NOT EXISTS public.portal_user_bindings (
  user_id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_user_bindings_client ON public.portal_user_bindings (client_id);

COMMENT ON TABLE public.portal_user_bindings IS
  'Mapeo auth.users → clients.id para portal autoservicio (JWT cliente).';

ALTER TABLE public.portal_user_bindings ENABLE ROW LEVEL SECURITY;

-- Solo service role gestiona bindings; clientes no leen la tabla directamente.
CREATE POLICY portal_user_bindings_service ON public.portal_user_bindings
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
