-- Keep current main production supplier tools working while V2 branch uses guarded wrappers.
grant execute on function public.smart_purchase_supplier_decision_v2(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_supplier_allocation_plan_v1(text,uuid) to anon,authenticated;
