-- ====================================================================
-- Advisor PERFORMANCE INFO: unindexed_foreign_keys (lint 0001)
--
-- Índices de cobertura sobre FKs sin índice. Acelera JOINs/cascades y
-- silencia el linter. Idempotente (IF NOT EXISTS).
--
-- Nota: NO se eliminan índices "unused_index" del advisor — en staging
-- con poco tráfico aparecen como no usados aunque sean necesarios
-- (tenant_id, billing, WG, etc.). Revisar unused_index solo con métricas
-- de producción reales.
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON public.audit_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_cash_register_entries_client_id
  ON public.cash_register_entries (client_id);

CREATE INDEX IF NOT EXISTS idx_client_alternate_contacts_client_id
  ON public.client_alternate_contacts (client_id);

CREATE INDEX IF NOT EXISTS idx_client_documents_client_id
  ON public.client_documents (client_id);

CREATE INDEX IF NOT EXISTS idx_commercial_appointments_client_id
  ON public.commercial_appointments (client_id);

CREATE INDEX IF NOT EXISTS idx_commercial_appointments_prospect_id
  ON public.commercial_appointments (prospect_id);

CREATE INDEX IF NOT EXISTS idx_commercial_appointments_work_order_id
  ON public.commercial_appointments (work_order_id);

CREATE INDEX IF NOT EXISTS idx_commercial_prospects_plan_id
  ON public.commercial_prospects (plan_id);

CREATE INDEX IF NOT EXISTS idx_commercial_quotes_client_id
  ON public.commercial_quotes (client_id);

CREATE INDEX IF NOT EXISTS idx_commercial_quotes_plan_id
  ON public.commercial_quotes (plan_id);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_id
  ON public.credit_notes (invoice_id);

CREATE INDEX IF NOT EXISTS idx_fiber_threads_continues_to_nap_id
  ON public.fiber_threads (continues_to_nap_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id
  ON public.invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_nap_ports_continues_to_nap_id
  ON public.nap_ports (continues_to_nap_id);

CREATE INDEX IF NOT EXISTS idx_nap_ports_thread_id
  ON public.nap_ports (thread_id);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_client_id
  ON public.payment_receipts (client_id);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment_id
  ON public.payment_receipts (payment_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_purchase_order_id
  ON public.purchase_order_lines (purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id
  ON public.purchase_orders (supplier_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
  ON public.role_permissions (permission_id);

CREATE INDEX IF NOT EXISTS idx_suspension_action_logs_client_id
  ON public.suspension_action_logs (client_id);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id
  ON public.ticket_attachments (ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id
  ON public.ticket_history (ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id
  ON public.ticket_messages (ticket_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id
  ON public.user_roles (role_id);

CREATE INDEX IF NOT EXISTS idx_wireguard_ip_allocations_peer_id
  ON public.wireguard_ip_allocations (peer_id);

CREATE INDEX IF NOT EXISTS idx_work_order_evidences_work_order_id
  ON public.work_order_evidences (work_order_id);

CREATE INDEX IF NOT EXISTS idx_work_order_history_work_order_id
  ON public.work_order_history (work_order_id);
