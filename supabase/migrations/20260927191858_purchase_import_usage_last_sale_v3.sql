CREATE OR REPLACE FUNCTION public.smart_purchase_center_guarded_v3(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_result jsonb;
  v_import_id uuid;
begin
  v_result:=public.smart_purchase_center_guarded_v2(p_session_token,p_action,p_payload);

  if p_action='import' and coalesce((v_result->>'ok')::boolean,false) then
    v_import_id:=nullif(v_result->'data'->>'id','')::uuid;

    if v_import_id is not null then
      update public.purchase_analysis_items i
      set
        avg_daily_usage=case
          when coalesce((i.source_row->>'avg_daily_usage')::numeric,0)>0
            then greatest(0,(i.source_row->>'avg_daily_usage')::numeric)
          when coalesce((i.source_row->>'sales_30')::numeric,0)>0
           and coalesce((i.source_row->>'sales_60')::numeric,0)>0
           and coalesce((i.source_row->>'sales_90')::numeric,0)>0
            then ((i.source_row->>'sales_30')::numeric/30.0)*0.50
               + ((i.source_row->>'sales_60')::numeric/60.0)*0.30
               + ((i.source_row->>'sales_90')::numeric/90.0)*0.20
          when coalesce((i.source_row->>'sales_30')::numeric,0)>0
           and coalesce((i.source_row->>'sales_90')::numeric,0)>0
            then ((i.source_row->>'sales_30')::numeric/30.0)*0.60
               + ((i.source_row->>'sales_90')::numeric/90.0)*0.40
          when coalesce((i.source_row->>'sales_30')::numeric,0)>0
           and coalesce((i.source_row->>'sales_60')::numeric,0)>0
            then ((i.source_row->>'sales_30')::numeric/30.0)*0.65
               + ((i.source_row->>'sales_60')::numeric/60.0)*0.35
          else greatest(
            coalesce((i.source_row->>'sales_30')::numeric,0)/30.0,
            coalesce((i.source_row->>'sales_60')::numeric,0)/60.0,
            coalesce((i.source_row->>'sales_90')::numeric,0)/90.0,
            0
          )
        end,
        last_sale_date=case
          when coalesce(i.source_row->>'last_sale_date','') ~ '^\d{4}-\d{2}-\d{2}$'
            then (i.source_row->>'last_sale_date')::date
          else i.last_sale_date
        end
      where i.import_id=v_import_id;
    end if;
  end if;

  return v_result;
end $function$


revoke all on function public.smart_purchase_center_guarded_v3(text,text,jsonb) from public;
grant execute on function public.smart_purchase_center_guarded_v3(text,text,jsonb) to anon,authenticated;
