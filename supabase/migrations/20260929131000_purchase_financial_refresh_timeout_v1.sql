-- Refreshing financial purchase readiness calls budget, inventory and clearance engines.
-- Keep the global anon timeout unchanged; grant only this batch refresh enough headroom.

alter function public.smart_purchase_decision_daily_change_v1(text, text)
  set statement_timeout = '20s';
