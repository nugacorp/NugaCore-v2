-- Torre onboarding opcional: zona, router vinculado y corte de facturación.
CREATE TABLE IF NOT EXISTS public.tower_onboarding_profiles (
  tower_id TEXT PRIMARY KEY REFERENCES public.towers(id) ON DELETE CASCADE,
  zone_name TEXT,
  billing_cycle_day INTEGER CHECK (billing_cycle_day BETWEEN 1 AND 31),
  billing_cycle_time TIME,
  router_id TEXT,
  router_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tower_onboarding_zone
  ON public.tower_onboarding_profiles (zone_name);
