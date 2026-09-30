-- Batch-only timeout budgets for the clean purchase flow.
-- Keep the global anon timeout at 3s; only the bounded heavy RPCs get local budgets.

alter function public.smart_purchase_finalize_dual_stock_master_v1(text, text, integer)
  set statement_timeout = '12s';

alter function public.smart_purchase_dual_branch_instant_plan_v1(text, numeric, numeric)
  set statement_timeout = '20s';

alter function public.smart_purchase_create_dual_drafts_v1(text, text, text)
  set statement_timeout = '15s';
