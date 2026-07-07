-- ====================================================================
-- CRM Comercial + ERP Operativo WISP (Fase plan CRM/ERP)
-- Aditivo e idempotente. USE_DB_COMMERCIAL / gastos en finance-operational.
-- ====================================================================

-- CRM Comercial: pipeline de ventas
CREATE TABLE IF NOT EXISTS public.commercial_prospects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  source TEXT DEFAULT 'walk-in',
  stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'visit', 'quote', 'contract', 'installation', 'won', 'lost')),
  plan_id TEXT REFERENCES public.plans(id) ON DELETE SET NULL,
  assigned_to TEXT,
  notes TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  expected_close_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.commercial_quotes (
  id TEXT PRIMARY KEY,
  prospect_id TEXT REFERENCES public.commercial_prospects(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  plan_id TEXT REFERENCES public.plans(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.commercial_appointments (
  id TEXT PRIMARY KEY,
  prospect_id TEXT REFERENCES public.commercial_prospects(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  work_order_id TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  appointment_type TEXT NOT NULL DEFAULT 'visit'
    CHECK (appointment_type IN ('visit', 'installation', 'survey', 'followup')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  technician_id TEXT,
  technician_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'canceled', 'no_show')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_prospects_stage ON public.commercial_prospects (stage);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_prospect ON public.commercial_quotes (prospect_id);
CREATE INDEX IF NOT EXISTS idx_commercial_appointments_scheduled ON public.commercial_appointments (scheduled_at);

-- ERP 5.2: series y garantías por unidad
CREATE TABLE IF NOT EXISTS public.inventory_serial_units (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  serial TEXT NOT NULL UNIQUE,
  mac TEXT,
  warranty_until DATE,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'installed', 'rma', 'retired')),
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  installed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_serial_item ON public.inventory_serial_units (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_serial_client ON public.inventory_serial_units (client_id);

-- Compras ligeras
CREATE TABLE IF NOT EXISTS public.suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ordered', 'received', 'canceled')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  inventory_item_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- P&L operativo: gastos categorizados
CREATE TABLE IF NOT EXISTS public.operational_expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL
    CHECK (category IN ('payroll', 'rent', 'utilities', 'equipment', 'marketing', 'maintenance', 'other')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  expense_date DATE NOT NULL,
  vendor TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operational_expenses_date ON public.operational_expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_operational_expenses_category ON public.operational_expenses (category);
