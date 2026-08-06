import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const SOURCE_ENTITIES = ['PurchaseInvoice','SupplierPayment','Expense','Return','Supplier','ShiftDelivery','PharmacyOrder','CustomerOrder'] as const;
const PAGE_SIZE = 200;
const MAX_RETRIES = 3;

async function sendBatch(url: string, secret: string, payload: Record<string, unknown>) {
  let lastError = 'snapshot_request_failed';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${url}/functions/v1/base44-sync-receiver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dawaa-Sync-Secret': secret },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result?.ok !== false) return result;
      lastError = result?.error || result?.details || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < MAX_RETRIES) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw new Error(lastError);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || !['admin','general_manager'].includes(String(user.role || ''))) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
    const syncSecret = Deno.env.get('BASE44_SYNC_SECRET') || '';
    if (!syncSecret) return Response.json({ ok: false, error: 'BASE44_SYNC_SECRET_missing' }, { status: 500 });

    const snapshotId = crypto.randomUUID();
    const summary: Record<string, { records: number; batches: number }> = {};
    for (const entityName of SOURCE_ENTITIES) {
      const entity = (base44.asServiceRole.entities as Record<string, any>)[entityName];
      if (!entity) throw new Error(`unsupported_entity:${entityName}`);
      let offset = 0;
      let batchNumber = 1;
      let totalRecords = 0;
      while (true) {
        const rows = await entity.list('-updated_date', PAGE_SIZE, offset);
        const records = Array.isArray(rows) ? rows : [];
        const isLastBatch = records.length < PAGE_SIZE;
        await sendBatch(supabaseUrl, syncSecret, {
          mode: 'full_snapshot', snapshot_id: snapshotId, source_entity: entityName,
          batch_number: batchNumber, is_last_batch: isLastBatch, records,
        });
        totalRecords += records.length;
        if (isLastBatch) break;
        offset += PAGE_SIZE;
        batchNumber += 1;
      }
      summary[entityName] = { records: totalRecords, batches: batchNumber };
    }
    return Response.json({ ok: true, snapshot_id: snapshotId, entities: summary });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
