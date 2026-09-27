-- Purchase V2 performance indexes identified by the Supabase advisor.
create index if not exists purchase_branch_policies_updated_by_account_idx
  on public.purchase_branch_policies(updated_by_account_id);

create index if not exists purchase_product_policies_updated_by_account_idx
  on public.purchase_product_policies(updated_by_account_id);

create index if not exists purchase_order_supplier_dispatches_sent_by_account_idx
  on public.purchase_order_supplier_dispatches(sent_by_account_id);

create index if not exists purchase_analysis_imports_created_by_account_idx
  on public.purchase_analysis_imports(created_by_account_id);

create index if not exists purchase_order_receipt_items_order_item_idx
  on public.purchase_order_receipt_items(order_item_id);

create index if not exists purchase_order_receipts_created_by_account_idx
  on public.purchase_order_receipts(created_by_account_id);

create index if not exists smart_purchase_order_items_analysis_item_idx
  on public.smart_purchase_order_items(analysis_item_id);

create index if not exists smart_purchase_order_items_supplier_offer_idx
  on public.smart_purchase_order_items(supplier_offer_id);

create index if not exists smart_purchase_orders_created_by_account_idx
  on public.smart_purchase_orders(created_by_account_id);

create index if not exists smart_purchase_orders_approved_by_account_idx
  on public.smart_purchase_orders(approved_by_account_id);

create index if not exists smart_purchase_orders_source_import_idx
  on public.smart_purchase_orders(source_import_id);

create index if not exists smart_purchase_customer_followups_pharmacy_order_idx
  on public.smart_purchase_customer_followups(pharmacy_order_id);

create index if not exists smart_purchase_orders_branch_status_created_idx
  on public.smart_purchase_orders(branch,status,created_at desc);

create index if not exists smart_purchase_order_items_order_active_idx
  on public.smart_purchase_order_items(order_id,approved_quantity)
  where approved_quantity>0;

create index if not exists purchase_order_receipts_order_supplier_invoice_idx
  on public.purchase_order_receipts(order_id,lower(trim(supplier_name)),lower(trim(supplier_invoice_number)))
  where supplier_invoice_number is not null;
