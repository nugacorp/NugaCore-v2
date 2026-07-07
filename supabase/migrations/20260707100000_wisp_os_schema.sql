-- ====================================================================
-- WISP OS Plan Maestro — schema aditivo (Client 360, cobranza, SLA, backups)
-- ====================================================================

-- Client 360 enrichment
CREATE TABLE IF NOT EXISTS public.client_tags (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, label)
);

CREATE TABLE IF NOT EXISTS public.client_alternate_contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  channel TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms', 'email', 'phone')),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('ine', 'contract', 'receipt', 'installation_photo', 'other')),
  file_name TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_activity_log (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_tags_client ON public.client_tags (client_id);
CREATE INDEX IF NOT EXISTS idx_client_activity_client ON public.client_activity_log (client_id, created_at DESC);

-- Cobranza operativa
CREATE TABLE IF NOT EXISTS public.payment_promises (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  promised_date DATE NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fulfilled', 'broken', 'canceled')),
  blocks_suspension BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cash_register_entries (
  id TEXT PRIMARY KEY,
  collector_id TEXT,
  collector_name TEXT,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  invoice_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  payment_method TEXT NOT NULL DEFAULT 'Efectivo',
  reference TEXT,
  notes TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_promises_client ON public.payment_promises (client_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_register_date ON public.cash_register_entries (entry_date);

-- Tickets SLA
CREATE TABLE IF NOT EXISTS public.ticket_sla_rules (
  id TEXT PRIMARY KEY,
  priority TEXT NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  max_hours INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.ticket_sla_rules (id, priority, max_hours) VALUES
  ('sla-p1', 'P1', 4),
  ('sla-p2', 'P2', 8),
  ('sla-p3', 'P3', 24),
  ('sla-p4', 'P4', 72)
ON CONFLICT (id) DO NOTHING;

-- MikroTik config backups (gated — metadata only; content in storage or encrypted blob)
CREATE TABLE IF NOT EXISTS public.router_config_backups (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL,
  backup_type TEXT NOT NULL DEFAULT 'export' CHECK (backup_type IN ('export', 'binary')),
  content_hash TEXT NOT NULL,
  content_preview TEXT,
  size_bytes INTEGER,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_router_backups_router ON public.router_config_backups (router_id, created_at DESC);
