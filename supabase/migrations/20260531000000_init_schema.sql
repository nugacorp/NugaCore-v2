-- ====================================================================
-- DATABASE SCHEMA : NugaCore ERP (Supabase / PostgreSQL)
-- Developed for NugaCorp (México)
-- Purpose: Complete WISP/FTTH CRM/ERP central schema
--
-- CONTRACT: This schema is realigned to docs/DATA_CONTRACT.md.
--   - Frontend (src/types.ts) is the source of truth.
--   - Enum values are stored in ENGLISH, matching the frontend exactly.
--   - Business entities use TEXT primary keys (semantic slugs: 'c-1',
--     'plan-basic', 'fac-101'). IAM tables use UUID (tied to auth.users).
--   - Column names are snake_case; the repository layer maps to camelCase.
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- 1. ENUMS (values in English, aligned to src/types.ts)
-- ====================================================================

-- Client (src/types.ts: Client)
CREATE TYPE client_status AS ENUM ('active', 'suspended', 'lead', 'baja');
CREATE TYPE client_type AS ENUM ('residential', 'corporate', 'government', 'hotel', 'school');
CREATE TYPE connection_type AS ENUM ('WISP', 'FTTH');

-- Plans (src/types.ts: Plan.type = technical method; store PlanMetadata.businessType = business)
CREATE TYPE plan_tech_type AS ENUM ('PPPoE', 'Hotspot', 'DHCP', 'Static');
CREATE TYPE plan_business_type AS ENUM ('Residencial', 'Empresarial', 'Dedicado');

-- Billing (src/types.ts: Invoice)
CREATE TYPE invoice_status AS ENUM ('paid', 'unpaid', 'overdue', 'canceled');
CREATE TYPE cfdi_status AS ENUM ('pending', 'generated', 'canceled');
CREATE TYPE payment_method AS ENUM ('Efectivo', 'Transferencia', 'OXXO', 'MercadoPago', 'Stripe', 'PayPal', 'SPEI', 'Otro');

-- Network / devices (src/types.ts: Tower.status / OltFTTH.status / OnuFTTH.status)
CREATE TYPE device_status AS ENUM ('online', 'warning', 'offline');
CREATE TYPE olt_status AS ENUM ('online', 'offline');
CREATE TYPE onu_status AS ENUM ('online', 'offline', 'dying_gasp');

-- Tickets (src/types.ts: Ticket)
CREATE TYPE ticket_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_status AS ENUM ('open', 'assigned', 'resolved', 'closed');

-- Work orders (src/types.ts: TaskOrder)
CREATE TYPE work_order_type AS ENUM ('installation', 'repair', 'migration', 'reallocation');
CREATE TYPE work_order_status AS ENUM ('pending', 'in_progress', 'completed', 'canceled');

-- Inventory (src/types.ts: WarehouseItem.category; store InventoryItemState.operationalStatus)
CREATE TYPE inventory_category AS ENUM ('CPE', 'Router', 'Switch', 'Antenna', 'Fiber', 'OLT', 'Other');
CREATE TYPE equipment_operational_status AS ENUM ('Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja');

-- Monitoring / alerts (store: MonitoringSnapshot / NocAlert)
CREATE TYPE monitoring_status AS ENUM ('online', 'offline', 'degraded');
CREATE TYPE alert_source_type AS ENUM ('tower', 'olt', 'client', 'system');
CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');


-- ====================================================================
-- 2. CORE SECURITY & AUTHENTICATION (IAM — UUID, tied to Supabase Auth)
-- ====================================================================

CREATE TABLE public.users_profile (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,  -- 'Super Admin','Administrador','Cobranza','Técnico','Soporte','Solo lectura'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,  -- 'customers.create', 'bills.pay', ...
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.user_roles (
  user_id UUID REFERENCES public.users_profile(id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE public.role_permissions (
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);


-- ====================================================================
-- 3. INTERNET PLANS  (src/types.ts: Plan + store PlanMetadata)
-- ====================================================================

CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,                                  -- slug: 'plan-basic'
  name TEXT NOT NULL UNIQUE,
  speed_down_mbps INTEGER NOT NULL,
  speed_up_mbps INTEGER NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  tech_type plan_tech_type NOT NULL DEFAULT 'PPPoE',     -- Plan.type
  business_type plan_business_type NOT NULL DEFAULT 'Residencial',  -- PlanMetadata.businessType
  is_active BOOLEAN NOT NULL DEFAULT TRUE,               -- PlanMetadata.isActive
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 4. CUSTOMERS & LEADS  (src/types.ts: Client, ClientTimelineEvent)
-- ====================================================================

CREATE TABLE public.clients (
  id TEXT PRIMARY KEY,                                  -- slug: 'c-1'
  full_name TEXT NOT NULL,                              -- Client.name
  type client_type NOT NULL DEFAULT 'residential',
  status client_status NOT NULL DEFAULT 'lead',
  email TEXT,
  phone TEXT,
  whatsapp TEXT,                                        -- brief field (nullable)
  address TEXT NOT NULL,
  colonia TEXT,                                         -- brief field (nullable)
  city TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  connection_type connection_type,                      -- Client.connectionType (optional)
  plan_id TEXT REFERENCES public.plans(id) ON DELETE SET NULL,
  ip_assigned TEXT,                                     -- Client.ip
  mac_address TEXT,                                     -- Client.mac
  ppp_user TEXT,                                        -- Client.pppoeUser
  ppp_password TEXT,                                    -- Client.pppoePassword
  contract_id TEXT,                                     -- Client.contractId
  installation_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  installation_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client.documents[]
CREATE TABLE public.client_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,                               -- document.url
  file_type TEXT,
  doc_date DATE,                                        -- document.date
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- store: ClientTimelineEvent
CREATE TABLE public.client_timeline (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                             -- created|status_change|lead_conversion|updated|note
  summary TEXT NOT NULL,
  details TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 5. BILLING & REVENUE  (src/types.ts: Invoice; store PaymentAllocation)
-- ====================================================================

CREATE TABLE public.invoices (
  id TEXT PRIMARY KEY,                                  -- slug: 'fac-101'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,                            -- denormalized (Invoice.clientName)
  amount NUMERIC(10, 2) NOT NULL,                       -- Invoice.amount
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0.00,     -- derived from invoice_payments
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,        -- Invoice.dateStr
  due_date DATE NOT NULL,                               -- Invoice.dueDateStr
  status invoice_status NOT NULL DEFAULT 'unpaid',
  cfdi_status cfdi_status NOT NULL DEFAULT 'pending',
  cfdi_uuid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoice.items[]
CREATE TABLE public.invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);

-- Invoice.payments[]  /  store PaymentAllocation
CREATE TABLE public.invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,                       -- payment.amount
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),      -- payment.date
  method payment_method NOT NULL DEFAULT 'Efectivo',
  transaction_id TEXT,                                  -- payment.transactionId
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 6. PHYSICAL NETWORK  (src/types.ts: Tower; store NetworkSector)
-- ====================================================================

CREATE TABLE public.towers (
  id TEXT PRIMARY KEY,                                  -- slug: 't-1'
  name TEXT NOT NULL UNIQUE,
  status device_status NOT NULL DEFAULT 'online',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  height NUMERIC(6, 2),                                 -- Tower.height
  coverage_radius_km NUMERIC(6, 2),                     -- Tower.coverageRadiusKm
  ip TEXT,                                              -- Tower.ip
  equipment JSONB NOT NULL DEFAULT '[]'::jsonb,         -- Tower.equipment[]
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,            -- Tower.photos[]
  created_at TIMESTAMPTZ DEFAULT NOW()
  -- NOTE: live telemetry (cpu/ram/temp/ping/uptime/ports) is NOT persisted;
  --       it is sourced from monitoring_snapshots or the live device.
);

CREATE TABLE public.network_sectors (
  id TEXT PRIMARY KEY,                                  -- slug: 'sec-1'
  tower_id TEXT NOT NULL REFERENCES public.towers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  azimuth INTEGER,                                      -- NetworkSector.azimuth
  frequency TEXT,
  channel_width TEXT,                                   -- optional (legacy SQL field)
  ip_address TEXT,
  ssid TEXT,
  technology TEXT,
  device_brand TEXT,
  status device_status NOT NULL DEFAULT 'online',
  clients_count INTEGER NOT NULL DEFAULT 0
);


-- ====================================================================
-- 7. FTTH ACCESS  (src/types.ts: OltFTTH, OnuFTTH, NapBox, NapPort)
-- ====================================================================

CREATE TABLE public.olts (
  id TEXT PRIMARY KEY,                                  -- slug: 'olt-1'
  name TEXT NOT NULL UNIQUE,
  status olt_status NOT NULL DEFAULT 'online',
  brand TEXT NOT NULL,                                  -- GPON|EPON|XGS-PON|Huawei|ZTE|FiberHome
  ip TEXT NOT NULL,
  ports_count INTEGER NOT NULL DEFAULT 16,
  onus_connected INTEGER NOT NULL DEFAULT 0,
  onus_limit INTEGER NOT NULL DEFAULT 1024,
  splitters JSONB NOT NULL DEFAULT '[]'::jsonb,         -- OltFTTH.splitters[]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.onus (
  id TEXT PRIMARY KEY,                                  -- slug: 'onu-1'
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT,
  olt_id TEXT REFERENCES public.olts(id) ON DELETE SET NULL,
  port INTEGER,
  mac TEXT,
  signal_db NUMERIC(6, 2),                             -- OnuFTTH.signalDb (e.g. -21.4)
  status onu_status NOT NULL DEFAULT 'online',
  brand TEXT,
  model TEXT,
  nap_id TEXT,
  nap_port INTEGER
);

CREATE TABLE public.nap_boxes (
  id TEXT PRIMARY KEY,                                  -- slug: 'NAP-01'
  name TEXT NOT NULL,
  pon_port TEXT,                                        -- NapBox.ponPort
  fibers_free INTEGER NOT NULL DEFAULT 0,
  fibers_total INTEGER NOT NULL DEFAULT 0,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  split_ratio TEXT,                                    -- NapBox.splitRatio
  coverage_meters INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.nap_ports (
  nap_id TEXT NOT NULL REFERENCES public.nap_boxes(id) ON DELETE CASCADE,
  num INTEGER NOT NULL,                                -- NapPort.num
  status TEXT NOT NULL DEFAULT 'free',                 -- occupied|free
  client TEXT NOT NULL DEFAULT '',                     -- NapPort.client (label)
  PRIMARY KEY (nap_id, num)
);


-- ====================================================================
-- 8. MIKROTIK  (store: MikrotikRouterRegistryItem, MikrotikCommandAudit)
-- ====================================================================

CREATE TABLE public.mikrotik_routers (
  id TEXT PRIMARY KEY,                                  -- slug: 'mkt-1'
  name TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL,
  api_port INTEGER NOT NULL DEFAULT 8728,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,                    -- server-side encrypted (see backend/services/crypto.ts)
  is_online BOOLEAN NOT NULL DEFAULT TRUE,
  cpu_usage_pct INTEGER NOT NULL DEFAULT 0,
  memory_usage_pct INTEGER NOT NULL DEFAULT 0,          -- store uses PERCENT (not free MB)
  routeros_version TEXT,
  linked_tower_id TEXT REFERENCES public.towers(id) ON DELETE SET NULL,
  last_health_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.mikrotik_command_audit (
  id TEXT PRIMARY KEY,
  router_id TEXT REFERENCES public.mikrotik_routers(id) ON DELETE SET NULL,
  router_name TEXT,
  command TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read',                   -- read|write
  status TEXT NOT NULL DEFAULT 'allowed',              -- allowed|blocked|executed
  executed_by TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 9. SUPPORT  (src/types.ts: Ticket, TaskOrder)
-- ====================================================================

CREATE TABLE public.tickets (
  id TEXT PRIMARY KEY,                                  -- slug: 'tk-1'
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  severity ticket_severity NOT NULL DEFAULT 'medium',
  priority TEXT,                                        -- P1|P2|P3|P4 (optional)
  status ticket_status NOT NULL DEFAULT 'open',
  sla_hours INTEGER NOT NULL DEFAULT 24,               -- Ticket.slaHours (was 'slam_hours')
  technician_id TEXT,
  technician_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),                -- Ticket.created
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT
);

CREATE TABLE public.ticket_history (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE TABLE public.work_orders (
  id TEXT PRIMARY KEY,                                  -- slug: 'wo-1'
  title TEXT NOT NULL,
  type work_order_type NOT NULL DEFAULT 'installation',
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  notes TEXT,
  date DATE,                                            -- TaskOrder.date
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  assigned_technician_id TEXT,
  technician_name TEXT,
  status work_order_status NOT NULL DEFAULT 'pending',
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{item,done}]
  signature TEXT,                                       -- base64
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.work_order_evidences (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'photo',                   -- photo|document
  url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT,
  notes TEXT
);

CREATE TABLE public.work_order_history (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);


-- ====================================================================
-- 10. INVENTORY  (src/types.ts: WarehouseItem; store states/movements)
-- ====================================================================

CREATE TABLE public.inventory_items (
  id TEXT PRIMARY KEY,                                  -- slug: 'item-1'
  name TEXT NOT NULL,
  category inventory_category NOT NULL DEFAULT 'Other',
  model TEXT,
  brand TEXT,
  qty INTEGER NOT NULL DEFAULT 0,                       -- WarehouseItem.qty
  warehouse TEXT NOT NULL DEFAULT 'Principal',
  serials JSONB NOT NULL DEFAULT '[]'::jsonb,           -- WarehouseItem.serials[]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.inventory_item_states (
  item_id TEXT PRIMARY KEY REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  operational_status equipment_operational_status NOT NULL DEFAULT 'Disponible',
  assigned_to_type TEXT,                               -- tower|client|technician|warehouse
  assigned_to_id TEXT,
  assigned_to_label TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.inventory_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  item_name TEXT,
  type TEXT NOT NULL,                                  -- in|out|transfer
  qty INTEGER NOT NULL,
  from_warehouse TEXT,
  to_warehouse TEXT,
  reason TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.inventory_assignments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  item_name TEXT,
  action TEXT NOT NULL,                                -- assign|unassign
  qty INTEGER NOT NULL DEFAULT 1,
  target_type TEXT,                                   -- tower|client|technician
  target_id TEXT,
  target_label TEXT,
  notes TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 11. MONITORING & ALERTS  (store: MonitoringSnapshot, NocAlert)
-- ====================================================================

CREATE TABLE public.monitoring_snapshots (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,                           -- tower|olt|router|client
  target_label TEXT,
  status monitoring_status NOT NULL DEFAULT 'online',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  packet_loss_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.noc_alerts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_type alert_source_type NOT NULL,
  severity alert_severity NOT NULL,
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE
);


-- ====================================================================
-- 12. SUSPENSION & AUTOMATION  (store: SuspensionPolicy, AutomationRule)
-- ====================================================================

-- Singleton config (one row, id='default')
CREATE TABLE public.suspension_policy (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  grace_days INTEGER NOT NULL DEFAULT 3,
  allow_auto_reactivate_on_payment BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.suspension_action_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT,
  action TEXT NOT NULL,                                -- suspend|reactivate|rule-scan
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',              -- manual|automation
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,                          -- AutomationRule.trigger (vencimiento|pago|suspension|alerta); 'trigger' is a reserved word
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  threshold INTEGER,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_run_at TIMESTAMPTZ
);


-- ====================================================================
-- 13. SECURITY & AUDIT
--   Two distinct, intentional models (see DATA_CONTRACT §4.10):
--   - audit_logs          : data/entity changes (old/new value)
--   - security_audit_logs : HTTP access trail (method/status)
-- ====================================================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                                -- 'SUSPEND_CLIENT', 'CREATE_PAYMENT'
  entity_type TEXT NOT NULL,                            -- 'clients', 'invoices'
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_origin TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.security_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  source TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 14. SYSTEM CONFIG SINGLETONS  (store: NotificationSettings, BackupPolicy)
-- ====================================================================

CREATE TABLE public.notification_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  latency_threshold_ms INTEGER NOT NULL DEFAULT 120,
  fiber_cut_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  browser_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  webhooks_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.backup_policy (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  frequency TEXT NOT NULL DEFAULT 'daily',             -- daily|weekly|monthly
  retention_days INTEGER NOT NULL DEFAULT 30,
  encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  location TEXT,
  last_backup_at TIMESTAMPTZ
);


-- ====================================================================
-- 15. updated_at TRIGGERS
-- ====================================================================

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_users_profile_modtime BEFORE UPDATE ON public.users_profile FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER trg_plans_modtime         BEFORE UPDATE ON public.plans          FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER trg_clients_modtime       BEFORE UPDATE ON public.clients        FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER trg_invoices_modtime      BEFORE UPDATE ON public.invoices       FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER trg_tickets_modtime       BEFORE UPDATE ON public.tickets        FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER trg_inventory_modtime     BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE PROCEDURE update_modified_column();


-- ====================================================================
-- 16. HELPFUL INDEXES (foreign keys / common filters)
-- ====================================================================

CREATE INDEX idx_clients_status        ON public.clients (status);
CREATE INDEX idx_clients_plan          ON public.clients (plan_id);
CREATE INDEX idx_client_timeline_client ON public.client_timeline (client_id);
CREATE INDEX idx_invoices_client       ON public.invoices (client_id);
CREATE INDEX idx_invoices_status       ON public.invoices (status);
CREATE INDEX idx_invoice_payments_inv  ON public.invoice_payments (invoice_id);
CREATE INDEX idx_sectors_tower         ON public.network_sectors (tower_id);
CREATE INDEX idx_onus_client           ON public.onus (client_id);
CREATE INDEX idx_onus_olt              ON public.onus (olt_id);
CREATE INDEX idx_tickets_client        ON public.tickets (client_id);
CREATE INDEX idx_tickets_status        ON public.tickets (status);
CREATE INDEX idx_work_orders_client    ON public.work_orders (client_id);
CREATE INDEX idx_security_audit_created ON public.security_audit_logs (created_at);
CREATE INDEX idx_audit_logs_entity     ON public.audit_logs (entity_type, entity_id);
