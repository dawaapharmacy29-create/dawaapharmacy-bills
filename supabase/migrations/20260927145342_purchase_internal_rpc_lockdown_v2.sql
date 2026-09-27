-- Lock internal purchase V2 RPCs behind their branch-aware public wrappers.
revoke all on function public.smart_purchase_set_order_policy_v2(text,uuid,numeric,numeric) from public,anon,authenticated;
revoke all on function public.smart_purchase_apply_item_plan_v2(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.smart_purchase_approve_order_v2(text,uuid) from public,anon,authenticated;
revoke all on function public.smart_purchase_apply_supplier_plan_v2(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.smart_purchase_product_policies_v2(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.smart_purchase_branch_policy_v2(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.smart_purchase_supplier_decision_v2(text,uuid) from public,anon,authenticated;
revoke all on function public.smart_purchase_supplier_allocation_plan_v1(text,uuid) from public,anon,authenticated;
revoke all on function public.smart_purchase_supplier_dispatch_v2(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.smart_purchase_order_evaluation_v2(text,uuid) from public,anon,authenticated;
revoke all on function public.smart_purchase_mark_sent_v2(text,uuid) from public,anon,authenticated;
