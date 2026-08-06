import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from "base44:runtime";
import { sendToSupabase, isConfigured } from '../../shared/dawaaSync.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { entity_name, record_id, event_type, payload, source_created_at, source_updated_at } = body;

    if (!entity_name || !record_id || !event_type) {
      return Response.json({ error: "entity_name, record_id, event_type are required" }, { status: 400 });
    }

    // Idempotency: skip if a record with same entity + record_id + updated_at + event_type exists
    const existing = await base44.asServiceRole.entities.SyncOutbox.filter({
      entity_name,
      record_id,
      event_type,
      source_updated_at: source_updated_at || ""
    });
    if (existing.length > 0) {
      return Response.json({ skipped: true, reason: "duplicate", event_id: existing[0].event_id });
    }

    const event_id = crypto.randomUUID();
    const payloadStr = payload ? JSON.stringify(payload) : "{}";

    const outbox = await base44.asServiceRole.entities.SyncOutbox.create({
      event_id,
      entity_name,
      record_id,
      event_type,
      payload: payloadStr,
      source_created_at: source_created_at || "",
      source_updated_at: source_updated_at || "",
      status: "pending",
      attempts: 0
    });

    const endpoint = secrets.get("DAWAA_SYNC_ENDPOINT") || "";
    const secret = secrets.get("DAWAA_SYNC_SECRET") || "";

    if (!isConfigured(endpoint, secret)) {
      await base44.asServiceRole.entities.SyncOutbox.update(outbox.id, {
        status: "pending_retry",
        attempts: 1,
        last_attempt_at: new Date().toISOString(),
        last_error: "إعدادات المزامنة غير مكتملة"
      });
      return Response.json({ status: "pending_retry", event_id, error: "config missing" });
    }

    const result = await sendToSupabase(endpoint, secret, {
      event_id,
      entity_name,
      record_id,
      event_type,
      payload: payload || {},
      source_created_at: source_created_at || "",
      source_updated_at: source_updated_at || ""
    });

    const now = new Date().toISOString();
    if (result.success) {
      await base44.asServiceRole.entities.SyncOutbox.update(outbox.id, {
        status: "synced",
        synced_at: now,
        response_data: result.data,
        attempts: 1,
        last_attempt_at: now,
        last_error: ""
      });
      return Response.json({ status: "synced", event_id });
    } else {
      await base44.asServiceRole.entities.SyncOutbox.update(outbox.id, {
        status: "pending_retry",
        attempts: 1,
        last_attempt_at: now,
        last_error: result.error
      });
      return Response.json({ status: "pending_retry", event_id, error: result.error });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
