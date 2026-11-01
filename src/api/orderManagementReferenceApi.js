// Uses the same-origin server function. The management secret never reaches the browser.
function currentStaffToken() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

export async function lookupManagementReference(mode, query, signal) {
  const session_token = currentStaffToken();
  if (!session_token) throw new Error('انتهت جلسة الموظف. سجل الدخول مرة أخرى.');
  const response = await fetch('/api/order-reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, query, session_token }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const errors = {
      reference_service_unconfigured: 'ربط بيانات الإدارة غير مفعّل على نسخة التجربة بعد.',
      invalid_session: 'انتهت جلسة الموظف. سجل الدخول مرة أخرى.',
      ambiguous_customer_code: 'كود العميل مرتبط بأكثر من سجل. يحتاج مراجعة في الإدارة.',
      management_lookup_unavailable: 'تعذر قراءة بيانات الإدارة حاليًا.',
      session_check_unavailable: 'تعذر التأكد من جلسة الموظف حاليًا.',
    };
    throw new Error(errors[data.error] || 'تعذر البحث. حاول مرة أخرى.');
  }
  return data.data;
}
