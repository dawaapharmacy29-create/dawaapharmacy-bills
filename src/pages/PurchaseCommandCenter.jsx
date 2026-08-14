import { ChevronDown } from 'lucide-react';
import PurchaseExecutiveDecisionCenter from '@/components/purchases/PurchaseExecutiveDecisionCenter';
import PurchaseDecisionDailyChange from '@/components/purchases/PurchaseDecisionDailyChange';
import SafePurchaseDraftBuilder from '@/components/purchases/SafePurchaseDraftBuilder';
import PurchaseCycleBudgetGuard from '@/components/purchases/PurchaseCycleBudgetGuard';
import InventoryCapitalCommandCenter from '@/components/purchases/InventoryCapitalCommandCenter';
import InventoryIntelligenceImport from '@/components/purchases/InventoryIntelligenceImport';
import SmartClearanceEngine from '@/components/purchases/SmartClearanceEngine';
import ClearanceOutcomeTracker from '@/components/purchases/ClearanceOutcomeTracker';
import SmartPurchaseUnifiedCenter from './SmartPurchaseUnifiedCenter';

function DetailSection({ id, title, description, children, open = false }) {
  return <details id={id} open={open} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
    <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-3">
      <div><div className="font-black text-lg">{title}</div><div className="mt-1 text-xs text-slate-500">{description}</div></div>
      <ChevronDown className="h-5 w-5 text-slate-500 shrink-0" />
    </summary>
    <div className="border-t bg-slate-50/40 p-3 md:p-4">{children}</div>
  </details>;
}

export default function PurchaseCommandCenter() {
  return <div dir="rtl" className="space-y-4 pb-8">
    <PurchaseExecutiveDecisionCenter />
    <PurchaseDecisionDailyChange />
    <SafePurchaseDraftBuilder />

    <DetailSection id="purchase-order-workspace" title="تنفيذ الطلبية" description="بعد ما تفهم قرار اليوم أو تنشئ مسودة آمنة، ابدأ من هنا لمراجعة الأصناف والكميات والموردين." open>
      <SmartPurchaseUnifiedCenter />
    </DetailSection>

    <DetailSection id="purchase-budget-details" title="تفاصيل ميزانية الدورة" description="المصروف، الالتزامات، الاحتياطي، المسار الزمني وتوقع نهاية الدورة.">
      <PurchaseCycleBudgetGuard />
    </DetailSection>

    <DetailSection id="purchase-stock-intelligence" title="تحليلات المخزون ورأس المال" description="الرواكد، الفلوس المحبوسة، عالية الدوران، المطلوب استوك، الربحية وGMROI.">
      <InventoryCapitalCommandCenter />
    </DetailSection>

    <DetailSection id="purchase-clearance" title="الصلاحية والتصريف والتحويل بين الفروع" description="راجع الـNear Expiry، هدف التصريف اليومي، وفرص التحويل قبل الخصم.">
      <SmartClearanceEngine />
    </DetailSection>

    <DetailSection id="purchase-clearance-outcomes" title="نتيجة خطط التصريف" description="هل انخفض الخطر فعليًا؟ وما قيمة رأس المال الذي خرج من منطقة الخطر؟">
      <ClearanceOutcomeTracker />
    </DetailSection>

    <DetailSection id="purchase-data-import" title="رفع بيانات الربحية والصلاحية" description="جزء اختياري لإضافة سعر البيع وBatch وتاريخ الصلاحية وكمية الباتش.">
      <InventoryIntelligenceImport />
    </DetailSection>
  </div>;
}
