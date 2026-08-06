import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

const DEFAULT_ENTITIES = [
  'Supplier',
  'SupplierPayment',
  'Expense',
  'Return',
  'ShiftDelivery',
  'PharmacyOrder',
  'CustomerOrder',
  'PurchaseInvoice',
];
const SUPPORTED_ENTITIES = new Set(DEFAULT_ENTITIES);
const MAX_BATCH_SIZE = 200;
const MAX_BATCHES_PER_CALL = 12;

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body.entities) ? body.entities.map(clean).filter(Boolean) : DEFAULT_ENTITIES;
    const entities = requested.filter((name) => SUPPORTED_ENTITIES.has(name));
    const snapshotId = clean(body.snapshot_id) || crypto.randomUUID();
    const batchSize = Math.min(Math.max(Number(body.batch_size || MAX_BATCH_SIZE), 1), MAX_BATCH_SIZE);
    const maxBatches = Math.min(Math.max(Number(body.max_batches || MAX_BATCHES_PER_CALL), 1), 25);
    let entityIndex = Math.max(Number(body.entity_index || 0), 0);
    let offset = Math.max(Number(body.offset || 0), 0);

    if (!entities.length) {
      return Response.json({ error: 'no_supported_entities' }, { status: 400 });
    }

    const endpoint = secrets.get('DAWAA_SYNC_ENDPOINT') || '';
    const secret = secrets.get('DAWAA_SYNC_SECRET') || '';
    if (!endpoint || !secret) {
      return Response.json({ error: 'sync_config_missing' }, { status: 500 });
    }

    const progress: Array<Record<string, unknown>> = [];
    let batchesSent = 0;

    while (entityIndex < entities.length && batchesSent < maxBatches) {
      const entityName = entities[entityIndex];
      const entityApi = base44.asServiceRole.entities[entityName];
      if (!entityApi?.list) {
        return Response.json({ error: 'entity_api_unavailable', entity_name: entityName }, { status: 500 });
      }

      const records = await entityApi.list('created_date', batchSize, offset);
      const rows = Array.isArray(records) ? records : [];
      const batchNumber = Math.floor(offset / batchSize) + 1;
      const isLastBatch = rows.length < batchSize;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dawaa-Sync-Secret': secret,
          'X-Dawaa-Event-Id': `${snapshotId}:${entityName}:${batchNumber}`,
        },
        body: JSON.stringify({
          mode: 'full_snapshot',
          snapshot_id: snapshotId,
          source_system: 'base44',
          source_entity: entityName,
          batch_number: batchNumber,
          is_last_batch: isLastBatch,
          records: rows,
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        return Response.json({
          error: 'snapshot_send_failed',
          status: response.status,
          details: responseText.slice(0, 1200),
          snapshot_id: snapshotId,
          entity_name: entityName,
          batch_number: batchNumber,
          entity_index: entityIndex,
          offset,
        }, { status: 502 });
      }

      progress.push({ entity_name: entityName, batch_number: batchNumber, records_sent: rows.length, is_last_batch: isLastBatch });
      batchesSent += 1;

      if (isLastBatch) {
        entityIndex += 1;
        offset = 0;
      } else {
        offset += rows.length;
      }
    }

    const completed = entityIndex >= entities.length;
    return Response.json({
      success: true,
      snapshot_id: snapshotId,
      completed,
      batches_sent: batchesSent,
      progress,
      continuation: completed ? null : {
        snapshot_id: snapshotId,
        entities,
        entity_index: entityIndex,
        offset,
        batch_size: batchSize,
        max_batches: maxBatches,
      },
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'snapshot_cycle_failed' }, { status: 500 });
  }
}

