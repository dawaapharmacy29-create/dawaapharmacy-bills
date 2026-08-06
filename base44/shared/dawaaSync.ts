const MAX_ATTEMPTS = 10;
const MAX_RESPONSE_LEN = 5000;
const MAX_ERROR_LEN = 500;

export function isConfigured(endpoint, secret) {
  return Boolean(endpoint && secret);
}

export async function sendToSupabase(endpoint, secret, event) {
  if (!endpoint || !secret) {
    return { success: false, status: 0, error: "إعدادات المزامنة غير مكتملة", data: "" };
  }

  const body = {
    event_id: event.event_id,
    source_system: "base44",
    source_entity: event.entity_name,
    source_record_id: event.record_id,
    event_type: event.event_type,
    source_created_at: event.source_created_at || "",
    source_updated_at: event.source_updated_at || "",
    payload: event.payload || {},
    sent_at: new Date().toISOString(),
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dawaa-Sync-Secret": secret,
        "X-Dawaa-Event-Id": event.event_id,
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    if (response.ok) {
      return {
        success: true,
        status: response.status,
        data: responseText.substring(0, MAX_RESPONSE_LEN),
        error: "",
      };
    }
    return {
      success: false,
      status: response.status,
      data: responseText.substring(0, MAX_RESPONSE_LEN),
      error: `HTTP ${response.status}: ${responseText.substring(0, MAX_ERROR_LEN)}`,
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      data: "",
      error: (error?.message || "Network error").substring(0, MAX_ERROR_LEN),
    };
  }
}

export function shouldFail(attempts) {
  return attempts >= MAX_ATTEMPTS;
}
