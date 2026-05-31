-- ====================================================================
-- DATABASE SCHEMA : NugaCore ERP v2.4 (Supabase / PostgreSQL)
-- Developed for NugaCorp (México)
-- Purpose: Complete WISP/FTTH CRM/ERP central schema
-- ====================================================================

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- 1. ENUMS AND CUSTOM TYPES
-- ====================================================================

-- Client Status Enum
CREATE TYPE client_status AS ENUM (
  'Prospecto',
  'Activo',
  'Suspendido',
  'Cancelado',
  'Moroso'
);

-- Connection Type Enum
CREATE TYPE connection_type AS ENUM (
  'WISP',
  'FTTH'
);

-- Plan Type Enum
CREATE TYPE service_plan_type AS ENUM (
  'Residencial',
  'Empresarial',
  'Dedicado'
);

-- Payment Status Enum
CREATE TYPE payment_status AS ENUM (
  'Pendiente',
  'Pagado',
  'Parcial',
  'Vencido',
  'Cancelado'
);

-- Payment Method Enum
CREATE TYPE payment_method AS ENUM (
  'Efectivo',
  'Transferencia',
  'OXXO',
  'MercadoPago',
  'Stripe',
  'Otro'
);

-- Network Device Status Enum
CREATE TYPE device_status AS ENUM (
  'online',
  'warning',
  'offline'
);

-- Ticket Status Enum
CREATE TYPE ticket_status_type AS ENUM (
  'Abierto',
  'En proceso',
  'En espera',
  'Resuelto',
  'Cerrado'
);

-- Ticket Priority Enum
CREATE TYPE ticket_priority_type AS ENUM (
  'Baja',
  'Media',
  'Alta',
  'Crítica'
);

-- Work Order Status Enum
CREATE TYPE work_order_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'cancelled'
);

-- Work Order Type Enum
CREATE TYPE work_order_type AS ENUM (
  'installation',
  'revision',
  'equipment_change',
  'reallocation',
  'retirement',
  'maintenance'
);

-- Equipment Status Enum
CREATE TYPE equipment_status_type AS ENUM (
  'Disponible',
  'Instalado',
  'En reparación',
  'Dañado',
  'Perdido',
  'Baja'
);


-- ====================================================================
-- 2. CORE SECURITY & AUTHENTICATION (FASE 1)
-- ====================================================================

-- Profiles table linked to auth.users (Supabase native Auth)
CREATE TABLE public.users_profile (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roles table
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE, -- 'Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions Table
CREATE TABLE public.permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE, -- 'customers.create', 'bills.pay', etc.
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Associative User Roles Table
CREATE TABLE public.user_roles (
  user_id UUID REFERENCES public.users_profile(id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Associative Role Permissions Table
CREATE TABLE public.role_permissions (
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);


-- ====================================================================
-- 3. INTERNET PLANS (FASE 3)
-- ====================================================================

CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,                      -- ex: "Plan Cobalto 20M"
  speed_down_mbps INTEGER NOT NULL,                -- Downstream rate
  speed_up_mbps INTEGER NOT NULL,                  -- Upstream rate
  price NUMERIC(10, 2) NOT NULL,                  -- Monthly recurring fee
  type service_plan_type NOT NULL DEFAULT 'Residencial',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 4. CUSTOMERS & LEADS (FASE 2)
-- ====================================================================

CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT NOT NULL,
  colonia TEXT,
  city TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status client_status NOT NULL DEFAULT 'Prospecto',
  connection_type connection_type NOT NULL DEFAULT 'FTTH',
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  ip_assigned TEXT,                               -- IP allocations
  mac_address TEXT,                               -- CPE/router MAC address
  ppp_user TEXT,                                  -- MikroTik PPPoE configuration credential
  ppp_password TEXT,
  installation_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client historical timeline/activity tracker logs (FASE 2.11)
CREATE TABLE public.client_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                        -- IP change, Status, Payment, Suspended
  summary TEXT NOT NULL,
  details TEXT,
  created_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client installation files / official documents (FASE 2.8 / 2.10)
CREATE TABLE public.client_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                             -- "Firma Contrato", "Foto Acometida", "INE"
  file_url TEXT NOT NULL,
  file_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 5. BILLING AND REVENUE MANAGEMENT (FASE 4 / FASE 5)
-- ====================================================================

-- Monthly general Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,            -- ex: "INV-2026-1002"
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  tax NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  amount_due NUMERIC(10, 2) NOT NULL,             -- Total to pay
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  status payment_status NOT NULL DEFAULT 'Pendiente',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Detailed transactions against invoices (Partial/Advance payments)
CREATE TABLE public.invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount_paid NUMERIC(10, 2) NOT NULL,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method payment_method NOT NULL DEFAULT 'Efectivo',
  transaction_reference TEXT,                     -- bank deposit reference code
  cash_received_by UUID REFERENCES public.users_profile(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 6. PHYSICAL INFRASTRUCTURE & NETWORK SITES (FASE 6 / FASE 7)
-- ====================================================================

-- Telecom site towers
CREATE TABLE public.towers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,                      -- ex: "T-DELVALLE"
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  height_meters NUMERIC(5, 2),
  tower_type TEXT,                                -- Autosoportada, Arriostrada, Monopolo
  power_system TEXT,                              -- AC, Banco de Baterías, Panel Solar
  batteries_bank TEXT,
  status device_status NOT NULL DEFAULT 'online',
  technical_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sectorial Antennas / Access Points on Towers
CREATE TABLE public.sectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tower_id UUID NOT NULL REFERENCES public.towers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                             -- ex: "Sector AC 5Ghz Poniente"
  frequency TEXT,                                 -- ex: "5745 MHz"
  channel_width TEXT,                             -- ex: "20 MHz"
  ip_address TEXT,
  ssid TEXT,
  technology TEXT,                                -- AC, AX, LTU
  device_brand TEXT,                              -- Ubiquiti, Cambium, Mimosa
  status device_status NOT NULL DEFAULT 'online'
);


-- ====================================================================
-- 7. MIKROTIK ROUTERS & FTTH OLTs (FASE 8)
-- ====================================================================

-- Core routers
CREATE TABLE public.mikrotik_routers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL,
  api_port INTEGER NOT NULL DEFAULT 8728,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,               -- Securely stored / decrypted server-side
  is_online BOOLEAN NOT NULL DEFAULT TRUE,
  cpu_usage_pct INTEGER DEFAULT 0,
  memory_free_mb INTEGER DEFAULT 0,
  routeros_version TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optical Line Terminals (OLT)
CREATE TABLE public.olts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL,
  brand TEXT NOT NULL,                            -- Huawei, ZTE, Fiberhome
  pon_ports_count INTEGER NOT NULL DEFAULT 16,
  status device_status NOT NULL DEFAULT 'online',
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 8. SERVICE TICKETS & WORK ORDERS (FASE 9 / FASE 10)
-- ====================================================================

-- Support issues
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,                         -- Facturación, Red Inalámbrica, Lentitud
  severity ticket_priority_type NOT NULL DEFAULT 'Media',
  status ticket_status_type NOT NULL DEFAULT 'Abierto',
  assigned_technician_id UUID REFERENCES public.users_profile(id),
  slam_hours INTEGER DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Detailed Technician orders with dynamic task checklists
CREATE TABLE public.work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  type work_order_type NOT NULL DEFAULT 'installation',
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  assigned_technician_id UUID REFERENCES public.users_profile(id),
  scheduled_date DATE,
  notes TEXT,
  status work_order_status NOT NULL DEFAULT 'pending',
  customer_signature_url TEXT,                    -- SVG canvas digital sign path
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,   -- Dynamic array of checkitems
  photos_before JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 9. GENERAL INVENTORY AND ERP PRODUCT STOCK (FASE 13)
-- ====================================================================

CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,                             -- Ubiquiti LiteBeam 5AC Gen2
  model TEXT,
  brand TEXT,
  sku_code TEXT UNIQUE,
  category TEXT NOT NULL,                         -- CPE, Router, Fibra Drop, ONU
  quantity INTEGER NOT NULL DEFAULT 0,
  min_required INTEGER NOT NULL DEFAULT 5,         -- Low status trigger
  status equipment_status_type NOT NULL DEFAULT 'Disponible',
  warehouse_name TEXT NOT NULL DEFAULT 'Bodega Central',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 10. CRITICAL AUDIT LOGS AND SECURITY LOGS (FASE 19)
-- ====================================================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                           -- "SUSPEND_CLIENT", "CREATE_PAYMENT"
  entity_type TEXT NOT NULL,                       -- "clients", "invoices"
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_origin TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- CREATE TIMESTAMPTZ TRIGGER HELPER FUNCTION
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Binds to automate updated_at
CREATE TRIGGER update_clients_modtime BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_plans_modtime BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_invoices_modtime BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_inventory_modtime BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
