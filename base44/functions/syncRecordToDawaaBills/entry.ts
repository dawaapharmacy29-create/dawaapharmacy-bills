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

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const entityName = clean(body.entity_name);
    const eventType = clean(body.event_type || 'update').toLowerCase();
    const recordId = clean(body.record_id);

    if (!SUPPORTED_ENTITIES.has(entityName)) {
      return Response.json({ error: 'unsupported_entity', entity_name: entityName }, { status: 400 });
    }
    if (!['create', 'update', 'delete'].includes(eventType)) {
      return Response.json({ error: 'unsupported_event_type', event_type: eventType }, { status: 400 });
    }
    if (!recordId) {
      return Response.json({ error: 'record_id_required' }, { status: 400 });
    }

    const endpoint = secrets.get('DAWAA_SYNC_ENDPOINT') || '';
    const secret = secrets.get('DAWAA_SYNC_SECRET') || '';
    if (!endpoint || !secret) {
      return Response.json({ error: 'sync_config_missing' }, { status: 500 });
    }

    const entityApi = base44.asServiceRole.entities[entityName];
    let record: Record<string, unknown> | null = null;
    if (eventType !== 'delete') {
      if (!entityApi?.get) {
        return Response.json({ error: 'entity_get_unavailable', entity_name: entityName }, { status: 500 });
      }
      record = await entityApi.get(recordId);
      if (!record) {
        return Response.json({ error: 'record_not_found', entity_name: entityName, record_id: recordId }, { status: 404 });
      }
    }

    const sourceUpdatedAt = clean(record?.updated_date || record?.updated_at) || new Date().toISOString();
    const sourceCreatedAt = clean(record?.created_date || record?.created_at) || null;
    const eventId = clean(body.event_id) || `${entityName}:${recordId}:${eventType}:${sourceUpdatedAt}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dawaa-Sync-Secret': secret,
        'X-Dawaa-Event-Id': eventId,
      },
      body: JSON.stringify({
        mode: 'event',
        source_system: 'base44',
        source_entity: entityName,
        source_record_id: recordId,
        event_type: eventType,
        source_created_at: sourceCreatedAt,
        source_updated_at: sourceUpdatedAt,
        payload: eventType === 'delete' ? { id: recordId } : record,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return Response.json({
        error: 'event_send_failed',
        status: response.status,
        details: responseText.slice(0, 1200),
        event_id: eventId,
      }, { status: 502 });
    }

    return Response.json({
      success: true,
      entity_name: entityName,
      record_id: recordId,
      event_type: eventType,
      event_id: eventId,
      receiver_response: responseText.slice(0, 2000),
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'record_sync_failed' }, { status: 500 });
  }
}

