import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

const SUPPORTED_ENTITIES = new Set([
  'ShiftDelivery',
  'PurchaseInvoice',
  'CustomerOrder',
  'PharmacyOrder',
  'SupplierPayment',
  'Expense',
  'Return',
  'Supplier',
]);

const MAX_BATCH_SIZE = 50;

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const entityName = String(body.entity_name || '').trim();
    const batchSize = Math.min(Math.max(Number(body.batch_size || 25), 1), MAX_BATCH_SIZE);
    const offset = Math.max(Number(body.offset || 0), 0);
    const snapshotId = String(body.snapshot_id || crypto.randomUUID());

    if (!SUPPORTED_ENTITIES.has(entityName)) {
      return Response.json({
        success: false,
        error: 'unsupported_entity',
        entity_name: entityName,
        supported_entities: [...SUPPORTED_ENTITIES],
      });
    }

    if (entityName === 'ShiftDelivery') {
      return Response.json({
        success: true,
        skipped: true,
        skip_reason: 'already_reconciled',
        snapshot_id: snapshotId,
        entity_name: entityName,
        batch_number: 1,
        records_sent: 0,
        is_last_batch: true,
        next_offset: null,
      });
    }

    const endpoint = secrets.get('DAWAA_SYNC_ENDPOINT') || '';
    const secret = secrets.get('DAWAA_SYNC_SECRET') || '';
    if (!endpoint || !secret) {
      return Response.json({ success: false, error: 'sync_config_missing', entity_name: entityName });
    }

    const entityApi = base44.asServiceRole.entities[entityName];
    if (!entityApi?.list) {
      return Response.json({ success: false, error: 'entity_api_unavailable', entity_name: entityName });
    }

    let records;
    try {
      records = await entityApi.list('created_date', batchSize, offset);
    } catch (primaryError) {
      try {
        records = await entityApi.list('-created_date', batchSize, offset);
      } catch (fallbackError) {
        return Response.json({
          success: false,
          error: 'entity_read_failed',
          entity_name: entityName,
          offset,
          primary_error: primaryError?.message || String(primaryError),
          fallback_error: fallbackError?.message || String(fallbackError),
        });
      }
    }

    const normalizedRecords = Array.isArray(records) ? records : [];
    const batchNumber = Math.floor(offset / batchSize) + 1;
    const isLastBatch = normalizedRecords.length < batchSize;

    let response: Response;
    try {
      response = await fetch(endpoint, {
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
          records: normalizedRecords,
        }),
      });
    } catch (networkError) {
      return Response.json({
        success: false,
        error: 'snapshot_network_failed',
        entity_name: entityName,
        batch_number: batchNumber,
        offset,
        details: networkError?.message || String(networkError),
      });
    }

    const responseText = await response.text();
    if (!response.ok) {
      return Response.json({
        success: false,
        error: 'snapshot_send_failed',
        status: response.status,
        details: responseText.slice(0, 2000),
        snapshot_id: snapshotId,
        entity_name: entityName,
        batch_number: batchNumber,
        offset,
      });
    }

    return Response.json({
      success: true,
      snapshot_id: snapshotId,
      entity_name: entityName,
      batch_number: batchNumber,
      records_sent: normalizedRecords.length,
      is_last_batch: isLastBatch,
      next_offset: isLastBatch ? null : offset + normalizedRecords.length,
      receiver_response: responseText.slice(0, 2000),
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error?.message || 'snapshot_export_failed',
    });
  }
}

