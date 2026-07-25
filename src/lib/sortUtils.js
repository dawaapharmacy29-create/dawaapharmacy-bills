/**
 * نظام الترتيب الموحد — دوال المقارنة والقوائم المسموحة.
 * يدعم: أرقام، تواريخ، نصوص عربية، حالات منطقية، قيم مالية.
 * القيم الفارغة دائمًا في النهاية.
 */

export const SORT_TYPES = {
  NUMBER: "number",
  DATE: "date",
  TEXT: "text",
  STATUS: "status",
  CURRENCY: "currency",
};

// ترتيب منطقي للحالات (تصاعدي = الأقل رقمًا أولًا)
export const INVOICE_STATUS_ORDER = {
  "انتظار المراجعة": 1,
  "تعلق تحت التصنف": 2,
  "تعلق تحت التصريف": 2,
  "يتم الحفظ": 3,
};
export const PAYMENT_STATUS_ORDER = { "كاش": 1, "انستا": 2, "فودافون": 3, "مختلط": 4, "آجل": 5 };
export const CATEGORY_ORDER = { medicines: 1, supplies_accessories: 2, unclassified: 3 };
export const TRANSACTION_ORDER = { external_purchase: 1, internal_transfer: 2 };
export const NET_MODE_ORDER = { inherit: 1, include: 2, exclude: 3 };
export const SUPPLIER_TYPE_ORDER = { external_supplier: 1, internal_branch: 2 };
export const RETURN_STATUS_ORDER = { Pending: 1, "Under Review": 2, Approved: 3, Returned: 4, Rejected: 5 };
export const SUPPLIER_CATEGORY_MODE_ORDER = { none: 1, medicines: 2, supplies_accessories: 3, mixed: 4 };
export const ORDER_STATUS_ORDER = {
  "طلب جديد": 1, "جاري البحث": 2, "تم الطلب": 3, "النواقص": 4,
  "تم توفير الصنف": 5, "تم توفير بديل": 6, "تم التوصيل": 7,
  "الصنف غير متوفر حاليا": 8, "تم الإلغاء": 9,
};
export const PRIORITY_ORDER = { "عاجل": 1, "متوسط": 2, "عادي": 3 };
export const USER_ROLE_ORDER = { admin: 1, manager: 2, viewer: 3 };
export const SLOW_STATUS_ORDER = {
  "راكد": 1, "منتظر التحويل": 2, "تم النقل": 3, "تم الإرجاع للشركة": 4, "تم التحويل لمنتهي": 5,
};
export const EXPIRED_STATUS_ORDER = {
  "منتهي": 1, "تم الإرجاع للشركة": 2, "تم التبديل / التصريف": 3,
};
export const SHIFT_TYPE_ORDER = { "صباحي": 1, "مسائي": 2, "ليلي": 3 };
export const REPLENISH_STATUS_ORDER = { pending: 1, shortage: 2, ordered: 3 };

// إزالة التشكيل وتوحيد الحروف العربية (أ/إ/آ→ا، ى→ي، ة→ه) للمقارنة فقط
function normalizeArabic(text) {
  return String(text ?? "")
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

export function parseNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

export function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return isNaN(t) ? null : t;
}

/**
 * مقارنة قيمتين حسب النوع.
 * يعيد: سالب إذا a قبل b، موجب إذا a بعد b، صفر إذا متساويان.
 * القيم الفارغة دائمًا في النهاية (بغضّ النظر عن الاتجاه).
 */
export function compareValues(a, b, type = "text", statusMap = {}) {
  switch (type) {
    case "number":
    case "currency": {
      const av = parseNumber(a);
      const bv = parseNumber(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    }
    case "date": {
      const av = parseDate(a);
      const bv = parseDate(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    }
    case "status": {
      const av = a != null && a !== "" ? (statusMap[a] ?? 999) : null;
      const bv = b != null && b !== "" ? (statusMap[b] ?? 999) : null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    }
    case "text":
    default: {
      const na = normalizeArabic(a);
      const nb = normalizeArabic(b);
      const aEmpty = !na;
      const bEmpty = !nb;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return na.localeCompare(nb, "ar");
    }
  }
}

/**
 * ترتيب مصفوفة حسب حقل واتجاه.
 * @param {Array} arr
 * @param {string} field
 * @param {"asc"|"desc"} direction
 * @param {string} type
 * @param {object} statusMap
 * @param {Function} getValue - دالة استخراج قيمة من السجل (للأعمدة المحسوبة)
 */
export function sortArray(arr, field, direction, type = "text", statusMap, getValue) {
  const dir = direction === "desc" ? -1 : 1;
  return [...arr].sort((a, b) => {
    const av = getValue ? getValue(a) : a?.[field];
    const bv = getValue ? getValue(b) : b?.[field];
    const cmp = compareValues(av, bv, type, statusMap);
    // القيم الفارغة تعامل داخل compareValues (تعود في النهاية دائمًا)
    return cmp === 0 ? 0 : dir * cmp;
  });
}

/**
 * تحقق أن الحقل مسموح به في القائمة (Allowlist).
 */
export function isFieldAllowed(field, allowedFields) {
  return Array.isArray(allowedFields) && allowedFields.includes(field);
}