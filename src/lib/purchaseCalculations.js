import { base44 } from "@/api/base44Client";

export const BRANCHES = ["دواء شكري", "دواء الشامي"];

export const EXCLUSION_REASONS = [
  { value: "internal_transfer", label: "تحويل داخلي بين الفروع" },
  { value: "not_actual_purchase", label: "فاتورة لا تدخل ضمن مشتريات الفرع الفعلية" },
  { value: "tracking_only", label: "فاتورة مسجلة للمتابعة فقط" },
  { value: "excluded_supplier", label: "مورد مستثنى من صافي المشتريات" },
  { value: "settlement", label: "تسوية حسابية" },
  { value: "duplicate_review", label: "فاتورة مكررة للمراجعة" },
  { value: "other", label: "أخرى" },
];

export const CATEGORY_LABELS = {
  medicines: "أدوية",
  supplies_accessories: "مستلزمات وإكسسوار",
  unclassified: "غير مصنفة",
};

export const CATEGORY_COLORS = {
  medicines: "bg-teal-100 text-teal-800",
  supplies_accessories: "bg-indigo-100 text-indigo-800",
  unclassified: "bg-gray-100 text-gray-600",
};

export const TRANSACTION_TYPE_LABELS = {
  external_purchase: "شراء خارجي",
  internal_transfer: "تحويل داخلي",
};

export const TRANSACTION_TYPE_COLORS = {
  external_purchase: "bg-blue-100 text-blue-800",
  internal_transfer: "bg-purple-100 text-purple-800",
};

export const NET_MODE_LABELS = {
  inherit: "اتباع إعداد المورد",
  include: "محتسبة يدويًا",
  exclude: "مستثناة يدويًا",
};

export const NET_MODE_COLORS = {
  inherit: "bg-gray-100 text-gray-700",
  include: "bg-green-100 text-green-800",
  exclude: "bg-red-100 text-red-800",
};

export const SUPPLIER_TYPE_LABELS = {
  external_supplier: "مورد خارجي",
  internal_branch: "فرع داخلي",
};

export const SUPPLIER_DEFAULT_CATEGORY_OPTIONS = [
  { value: "none", label: "غير محدد" },
  { value: "medicines", label: "أدوية" },
  { value: "supplies_accessories", label: "مستلزمات وإكسسوار" },
  { value: "mixed", label: "مختلط (أدوية + مستلزمات)" },
];

export const SUPPLIER_CATEGORY_MODE_LABELS = {
  medicines: "أدوية",
  supplies_accessories: "مستلزمات وإكسسوار",
  mixed: "مختلط (أدوية + مستلزمات)",
  none: "غير محدد",
};

export const SUPPLIER_CATEGORY_MODE_COLORS = {
  medicines: "bg-teal-100 text-teal-800",
  supplies_accessories: "bg-indigo-100 text-indigo-800",
  mixed: "bg-amber-100 text-amber-800",
  none: "bg-gray-100 text-gray-600",
};

export const CATEGORY_SOURCE_LABELS = {
  supplier_default: "تلقائي من المورد",
  supplier_backfill: "تطبيق رجعي من إعداد المورد",
  manual: "استثناء يدوي",
  supplier_bulk_apply: "تطبيق إعداد المورد",
  bulk_update: "تعديل جماعي",
  legacy_backfill: "تصحيح بيانات قديمة",
};

export const CATEGORY_SOURCE_COLORS = {
  supplier_default: "bg-teal-100 text-teal-800",
  supplier_backfill: "bg-cyan-100 text-cyan-800",
  manual: "bg-amber-100 text-amber-800",
  supplier_bulk_apply: "bg-cyan-100 text-cyan-800",
  bulk_update: "bg-purple-100 text-purple-800",
  legacy_backfill: "bg-blue-100 text-blue-800",
};

export const TRANSACTION_TYPE_SOURCE_LABELS = {
  manual: "يدوي",
  supplier_auto: "تلقائي من المورد",
  legacy_backfill: "تصحيح بيانات قديمة",
};

export const TRANSACTION_TYPE_SOURCE_COLORS = {
  manual: "bg-amber-100 text-amber-800",
  supplier_auto: "bg-teal-100 text-teal-800",
  legacy_backfill: "bg-blue-100 text-blue-800",
};

export function getExclusionReasonLabel(reason) {
  const found = EXCLUSION_REASONS.find((r) => r.value === reason);
  return found ? found.label : reason || "—";
}

/**
 * تحديد هل الفاتورة مستثناة من صافي المشتريات أم لا.
 * قاعدة الترتيب:
 * 1. التحويل الداخلي → مستثنى (لا يدخل في صافي المشتريات الخارجية)
 * 2. exclude يدويًا → مستثنى
 * 3. include يدويًا → محتسب (يتجاوز إعداد المورد)
 * 4. inherit → يتبع إعداد المورد
 * يتم الاستثناء مرة واحدة فقط مهما تعددت الأسباب.
 */
export function isInvoiceExcluded(invoice, suppliers = []) {
  // التحويل الداخلي لا يدخل في صافي المشتريات الخارجية
  if (invoice.transaction_type === "internal_transfer") {
    return {
      excluded: true,
      reason: "internal_transfer",
      source: "transaction_type",
    };
  }

  // استثناء يدوي صريح
  if (invoice.net_purchase_mode === "exclude") {
    return {
      excluded: true,
      reason: invoice.exclusion_reason || "manual_exclusion",
      source: "manual",
    };
  }

  // إدراج يدوي صريح (يتجاوز إعداد المورد)
  if (invoice.net_purchase_mode === "include") {
    return { excluded: false, reason: null, source: "manual_include" };
  }

  // وضع inherit — يتبع إعداد المورد (يفضل الربط بـ supplier_id، ويرجع للاسم كبديل)
  const supplier = (invoice.supplier_id && suppliers.find((s) => s.id === invoice.supplier_id))
    || suppliers.find((s) => s.name === invoice.supplier_name);
  if (supplier?.exclude_from_net_purchases) {
    return {
      excluded: true,
      reason: "excluded_supplier",
      source: "supplier",
    };
  }

  return { excluded: false, reason: null, source: "default" };
}

/**
 * حساب القيمة الصافية للفاتورة في صافي المشتريات (0 إذا مستثناة).
 */
export function getInvoiceNetAmount(invoice, suppliers = []) {
  const { excluded } = isInvoiceExcluded(invoice, suppliers);
  if (excluded) return 0;
  const gross = (invoice.total_value || 0) - (invoice.returned_value || 0);
  return Math.max(gross, 0);
}

/**
 * حساب الجزء الكاش من الفاتورة:
 * - كاش/انستا/فودافون: الإجمالي كامل
 * - مختلط: cash_amount المسجل
 * - آجل: 0
 */
export function getInvoiceCashAmount(invoice) {
  const gross = (invoice.total_value || 0) - (invoice.returned_value || 0);
  const pt = invoice.payment_type;

  if (["كاش", "انستا", "فودافون"].includes(pt)) {
    return gross;
  }

  if (pt === "مختلط" && invoice.cash_amount > 0) {
    return Math.min(invoice.cash_amount, gross);
  }

  return 0;
}

/**
 * حساب الجزء الآجل من الفاتورة.
 */
export function getInvoiceCreditAmount(invoice) {
  const gross = (invoice.total_value || 0) - (invoice.returned_value || 0);
  const cash = getInvoiceCashAmount(invoice);
  return Math.max(gross - cash, 0);
}

/**
 * الدالة المركزية لحساب ملخص المشتريات.
 * مصدر موحد لكل الحسابات: الداشبورد، التقارير، التصدير.
 */
export function calculatePurchaseSummary(invoices, suppliers = [], filters = {}) {
  const {
    dateFrom = null,
    dateTo = null,
    branch = null,
    supplier = null,
    category = null,
    paymentType = null,
    transactionType = null,
    netMode = null,
  } = filters;

  const filtered = invoices.filter((inv) => {
    const dateKey = inv.invoice_date || inv.created_date?.split("T")[0];
    if (dateFrom && (!dateKey || dateKey < dateFrom)) return false;
    if (dateTo && (!dateKey || dateKey > dateTo)) return false;
    if (branch && inv.branch !== branch) return false;
    if (supplier && inv.supplier_name !== supplier) return false;
    if (category && (inv.purchase_category || "unclassified") !== category) return false;
    if (paymentType && inv.payment_type !== paymentType) return false;
    if (transactionType && (inv.transaction_type || "external_purchase") !== transactionType) return false;
    return true;
  });

  const invoiceData = filtered.map((inv) => {
    const gross = (inv.total_value || 0) - (inv.returned_value || 0);
    const exclusion = isInvoiceExcluded(inv, suppliers);
    const isExcluded = exclusion.excluded;
    const netAmount = isExcluded ? 0 : Math.max(gross, 0);
    const cashAmount = getInvoiceCashAmount(inv);
    const netCashAmount = isExcluded ? 0 : cashAmount;
    const creditAmount = getInvoiceCreditAmount(inv);

    return {
      invoice: inv,
      gross_amount: gross,
      is_effectively_excluded: isExcluded,
      effective_exclusion_reason: exclusion.reason,
      exclusion_source: exclusion.source,
      net_amount: netAmount,
      cash_amount: cashAmount,
      net_cash_amount: netCashAmount,
      credit_amount: creditAmount,
      is_internal_transfer: (inv.transaction_type || "external_purchase") === "internal_transfer",
      category: inv.purchase_category || "unclassified",
      transaction_type: inv.transaction_type || "external_purchase",
    };
  });

  // فلترة حسب حالة الصافي إن طُلب
  let scopedData = invoiceData;
  if (netMode === "excluded") {
    scopedData = invoiceData.filter((d) => d.is_effectively_excluded);
  } else if (netMode === "included") {
    scopedData = invoiceData.filter((d) => !d.is_effectively_excluded);
  }

  const gross_purchases = invoiceData.reduce((s, d) => s + d.gross_amount, 0);
  const net_purchases = invoiceData.reduce((s, d) => s + d.net_amount, 0);
  const excluded_purchases = invoiceData
    .filter((d) => d.is_effectively_excluded)
    .reduce((s, d) => s + d.gross_amount, 0);
  const excluded_count = invoiceData.filter((d) => d.is_effectively_excluded).length;

  const cash_purchases = invoiceData.reduce((s, d) => s + d.cash_amount, 0);
  const net_cash_purchases = invoiceData.reduce((s, d) => s + d.net_cash_amount, 0);
  const excluded_cash_purchases = invoiceData
    .filter((d) => d.is_effectively_excluded)
    .reduce((s, d) => s + d.cash_amount, 0);
  const credit_purchases = invoiceData.reduce((s, d) => s + d.credit_amount, 0);

  const medicines_purchases = invoiceData
    .filter((d) => d.category === "medicines" && !d.is_effectively_excluded)
    .reduce((s, d) => s + d.gross_amount, 0);
  const supplies_accessories_purchases = invoiceData
    .filter((d) => d.category === "supplies_accessories" && !d.is_effectively_excluded)
    .reduce((s, d) => s + d.gross_amount, 0);
  const unclassified_purchases = invoiceData
    .filter((d) => d.category === "unclassified" && !d.is_effectively_excluded)
    .reduce((s, d) => s + d.gross_amount, 0);

  const internal_transfers = invoiceData
    .filter((d) => d.is_internal_transfer)
    .reduce((s, d) => s + d.gross_amount, 0);
  const internal_transfers_count = invoiceData.filter((d) => d.is_internal_transfer).length;
  const external_purchases = invoiceData
    .filter((d) => !d.is_internal_transfer)
    .reduce((s, d) => s + d.net_amount, 0);

  // تفصيل الفروع
  const branch_breakdown = {};
  BRANCHES.forEach((b) => {
    const bd = invoiceData.filter((d) => d.invoice.branch === b);
    branch_breakdown[b] = {
      gross_purchases: bd.reduce((s, d) => s + d.gross_amount, 0),
      net_purchases: bd.reduce((s, d) => s + d.net_amount, 0),
      excluded_purchases: bd.filter((d) => d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      cash_purchases: bd.reduce((s, d) => s + d.cash_amount, 0),
      net_cash_purchases: bd.reduce((s, d) => s + d.net_cash_amount, 0),
      medicines_purchases: bd.filter((d) => d.category === "medicines" && !d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      supplies_accessories_purchases: bd.filter((d) => d.category === "supplies_accessories" && !d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      unclassified_purchases: bd.filter((d) => d.category === "unclassified" && !d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      internal_transfers_in: bd.filter((d) => d.is_internal_transfer && d.invoice.destination_branch === b).reduce((s, d) => s + d.gross_amount, 0),
      internal_transfers_out: bd.filter((d) => d.is_internal_transfer && d.invoice.source_branch === b).reduce((s, d) => s + d.gross_amount, 0),
      invoice_count: bd.length,
    };
  });

  // تفصيل الموردين
  const supplierNames = [...new Set(filtered.map((inv) => inv.supplier_name).filter(Boolean))];
  const supplier_breakdown = supplierNames.map((name) => {
    const sd = invoiceData.filter((d) => d.invoice.supplier_name === name);
    const supplierInfo = suppliers.find((s) => s.id === sd[0]?.invoice.supplier_id)
      || suppliers.find((s) => s.name === name);
    return {
      supplier_name: name,
      supplier_type: supplierInfo?.supplier_type || "external_supplier",
      invoice_count: sd.length,
      gross_purchases: sd.reduce((s, d) => s + d.gross_amount, 0),
      net_purchases: sd.reduce((s, d) => s + d.net_amount, 0),
      excluded_purchases: sd.filter((d) => d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      cash_purchases: sd.reduce((s, d) => s + d.cash_amount, 0),
      credit_purchases: sd.reduce((s, d) => s + d.credit_amount, 0),
      medicines_purchases: sd.filter((d) => d.category === "medicines" && !d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      supplies_accessories_purchases: sd.filter((d) => d.category === "supplies_accessories" && !d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      unclassified_purchases: sd.filter((d) => d.category === "unclassified" && !d.is_effectively_excluded).reduce((s, d) => s + d.gross_amount, 0),
      internal_transfers: sd.filter((d) => d.is_internal_transfer).reduce((s, d) => s + d.gross_amount, 0),
      avg_invoice_value: sd.length > 0 ? sd.reduce((s, d) => s + d.gross_amount, 0) / sd.length : 0,
    };
  });

  return {
    invoice_count: filtered.length,
    gross_purchases,
    net_purchases,
    excluded_purchases,
    excluded_count,
    cash_purchases,
    net_cash_purchases,
    excluded_cash_purchases,
    credit_purchases,
    medicines_purchases,
    supplies_accessories_purchases,
    unclassified_purchases,
    internal_transfers,
    internal_transfers_count,
    external_purchases,
    branch_breakdown,
    supplier_breakdown,
    invoices: scopedData,
  };
}