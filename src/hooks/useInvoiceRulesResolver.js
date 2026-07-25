import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Hook لربط نموذج الفاتورة بقواعد الموردين عبر resolveInvoiceSupplierRules.
 * يستدعي الدالة الخلفية عند تغيير supplier_id / branch / category_source.
 * يعيد: resolution (نتيجة الدالة)، isLoading، رسائل تحذير/معلومات.
 *
 * الحفاظ على الاستثناء اليدوي: preserve_manual_override=true دائمًا.
 */
export function useInvoiceRulesResolver({
  supplierId,
  branch,
  currentCategory,
  categorySource,
  currentTransactionType,
  enabled = true,
}) {
  const [resolution, setResolution] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !supplierId || !branch) {
      setResolution(null);
      return;
    }

    // requestId لمنع Race Condition: فقط أحدث طلب يطبّق نتيجته
    const currentRequestId = ++requestIdRef.current;

    setIsLoading(true);

    base44.functions
      .invoke("resolveInvoiceSupplierRules", {
        supplier_id: supplierId,
        branch,
        current_purchase_category: currentCategory || "",
        purchase_category_source: categorySource || "",
        current_transaction_type: currentTransactionType || "external_purchase",
        preserve_manual_override: true,
      })
      .then((res) => {
        // Normalize: استخرج كائن النتيجة بغض النظر عن مستوى التغليف
        let result = null;
        if (res && res.resolved_purchase_category !== undefined) {
          result = res;
        } else if (res?.data?.resolved_purchase_category !== undefined) {
          result = res.data;
        } else if (res?.data?.data?.resolved_purchase_category !== undefined) {
          result = res.data.data;
        }

        // فقط أحدث طلب يطبّق نتيجته
        if (currentRequestId !== requestIdRef.current) {
          return;
        }

        setResolution(result);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("[InvoiceRulesResolver]", err?.message || err);
        if (currentRequestId === requestIdRef.current) {
          setResolution(null);
          setIsLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, branch, categorySource, currentCategory, enabled]);

  return { resolution, isLoading };
}