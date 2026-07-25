-- Allow the Factory onboarding template in persisted router enrollments.

ALTER TABLE public.router_enrollment
  DROP CONSTRAINT IF EXISTS chk_enrollment_template_id;

ALTER TABLE public.router_enrollment
  ADD CONSTRAINT chk_enrollment_template_id CHECK (
    template_id IN (
      'nugacore_factory_onboarding',
      'router_base_wireguard',
      'tower_wisp',
      'pcc_2wan',
      'pcc_3wan',
      'pcc_4wan',
      'pcc_5wan',
      'pppoe_server',
      'noc_ready',
      'monitoring_agent'
    )
  ) NOT VALID;

ALTER TABLE public.router_enrollment
  VALIDATE CONSTRAINT chk_enrollment_template_id;
