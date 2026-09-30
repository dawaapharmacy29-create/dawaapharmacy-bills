revoke all on function public.smart_purchase_safe_draft_preview_v1(text,text,numeric) from public, anon, authenticated;
revoke all on function public.smart_purchase_safe_draft_create_v1(text,text,numeric) from public, anon, authenticated;

revoke all on function public.smart_purchase_safe_draft_preview_v2(text,text,numeric,text) from public;
revoke all on function public.smart_purchase_safe_draft_create_v2(text,text,numeric,text) from public;
grant execute on function public.smart_purchase_safe_draft_preview_v2(text,text,numeric,text) to anon,authenticated;
grant execute on function public.smart_purchase_safe_draft_create_v2(text,text,numeric,text) to anon,authenticated;
