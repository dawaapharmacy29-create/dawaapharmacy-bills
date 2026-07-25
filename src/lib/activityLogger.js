import { base44 } from "@/api/base44Client";

/**
 * Logs a security-sensitive activity to ActivityLog.
 * Supports old/new values, batch IDs, status, and role context.
 */
export async function logActivity({
  action_type,
  entity_type,
  entity_id,
  record_id,
  entity_label,
  old_value,
  new_value,
  batch_id,
  status = "success",
  reason,
  details,
}) {
  try {
    const user = await base44.auth.me();
    await base44.entities.ActivityLog.create({
      action_type,
      entity_type,
      entity_id: entity_id || "",
      record_id: record_id || entity_id || "",
      entity_label: entity_label || "",
      user_email: user?.email || "",
      user_name: user?.full_name || "",
      user_role: user?.role || "",
      user_branch: user?.branch || "",
      old_value: old_value != null ? String(old_value) : "",
      new_value: new_value != null ? String(new_value) : "",
      batch_id: batch_id || "",
      status,
      reason: reason || "",
      details: details || "",
    });
  } catch (e) {
    // silent fail - logging should never break the main flow
  }
}