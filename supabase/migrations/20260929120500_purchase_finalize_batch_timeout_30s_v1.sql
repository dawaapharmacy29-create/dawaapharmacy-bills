-- The dual-stock finalize is an intentional atomic batch over both branch snapshots.
-- Keep the global anon timeout at 3s; give only this batch RPC enough cold-cache headroom.

alter function public.smart_purchase_finalize_dual_stock_master_v1(text, text, integer)
  set statement_timeout = '30s';
