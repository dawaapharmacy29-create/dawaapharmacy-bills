-- Cover remaining purchase-domain foreign keys reported by the Supabase performance advisor.
create index if not exists purchase_arrival_alerts_purchase_order_idx
  on public.purchase_arrival_alerts(purchase_order_id);

create index if not exists purchase_clearance_plan_runs_created_by_idx
  on public.purchase_clearance_plan_runs(created_by);

create index if not exists purchase_inventory_batches_imported_by_idx
  on public.purchase_inventory_batches(imported_by);

create index if not exists purchase_request_data_issues_resolved_by_account_idx
  on public.purchase_request_data_issues(resolved_by_account_id);

create index if not exists purchase_status_history_changed_by_account_idx
  on public.purchase_status_history(changed_by_account_id);

create index if not exists purchase_variance_decisions_decided_by_account_idx
  on public.purchase_variance_decisions(decided_by_account_id);

create index if not exists smart_purchase_learning_outcomes_analysis_item_idx
  on public.smart_purchase_learning_outcomes(analysis_item_id);

create index if not exists smart_purchase_orders_reservation_idx
  on public.smart_purchase_orders(reservation_id);

create index if not exists smart_purchase_orders_treasury_idx
  on public.smart_purchase_orders(treasury_id);

create index if not exists smart_purchase_receipt_facts_order_idx
  on public.smart_purchase_receipt_facts(order_id);

create index if not exists smart_purchase_receipt_facts_order_item_idx
  on public.smart_purchase_receipt_facts(order_item_id);
