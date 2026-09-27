// Purchase Architecture V2 preview checkpoint — no runtime behavior change.
import { Link } from 'react-router-dom';
import {
  BarChart3, ChevronDown, ClipboardCheck, PackageCheck, ShoppingCart, Sparkles, Truck,
} from 'lucide-react';
import PurchaseExecutiveDecisionCenter from '@/components/purchases/PurchaseExecutiveDecisionCenter';
import PurchaseDecisionDailyChange from '@/components/purchases/PurchaseDecisionDailyChange';
import SafePurchaseDraftBuilder from '@/components/purchases/SafePurchaseDraftBuilder';
import SupplierDecisionAdvisor from '@/components/purchases/SupplierDecisionAdvisor';
import SupplierAllocationPlanner from '@/components/purchases/SupplierAllocationPlanner';
import SupplierOfferImport from '@/components/purchases/SupplierOfferImport';
import SupplierPerformanceLearning from '@/components/purchases/SupplierPerformanceLearning';
import PurchaseCycleBudgetGuard from '@/components/purchases/PurchaseCycleBudgetGuard';
import InventoryCapitalCommandCenter from '@/components/purchases/InventoryCapitalCommandCenter';
import InventoryIntelligenceImport from '@/components/purchases/InventoryIntelligenceImport';
import SmartClearanceEngine from '@/components/purchases/SmartClearanceEngine';
import ClearanceOutcomeTracker from '@/components/purchases/ClearanceOutcomeTracker';
import SmartPurchaseUnifiedCenter from './SmartPurchaseUnifiedCenter';

function DetailSection({ id, title, description, children, open = false }) {
  return <details id={id} open={open} className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-3">
      <div><div className="font-black text-lg">{title}</div><div className="mt-1 text-xs text-slate-500">{description}</div></div>
      <ChevronDown className="h-5 w-5 text-slate-500 shrink-0" />
    </summary>
    <div className="border-t bg-slate-50/40 p-3 md:p-4">{children}</div>
  </details>;
}

const STEPS = [
  { n: '1', title: 'حدد الاحتياج', note: 'مبيعات + رصيد + تغطية', icon: Sparkles, href: '#purchase-decision-tools' },
  { n: '2', title: 'أنشئ الطلبية', note: 'Min/Max + ميزانية', icon: ShoppingCart, href: '#purchase-order-workspace' },
  { n: '3', title: 'راجع المورد', note: 'سعر + MOQ + بونص', icon: Truck, href: '#purchase-order-workspace' },
  { n: '4', title: 'استلم وطابق', note: 'كمية + سعر + فاتورة', icon: PackageCheck, to: '/smart-purchase-receiving' },
  { n: '5', title: 'تعلم من النتيجة', note: 'أداء المورد والشراء', icon: BarChart3, to: '/smart-purchase-insights' },
];

function WorkflowStep({ step }) {
  const Icon = step.icon;
  const body = <div className="h-full rounded-2xl border bg-white p-3 transition hover:border-teal-300 hover:shadow-sm">
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-black text-white">{step.n}</span>
      <Icon className="h-4 w-4 text-teal-700" />
      <div className="font-black text-sm text-slate-900">{step.title}</div>
    </div>
    <div className="mt-2 text-[11px] text-slate-500">{step.note}</div>
  </div>;
  return step.to ? <Link to={step.to} className="block h-full">{body}</Link> : <a href={step.href} className="block h-full">{body}</a>;
}

export default function PurchaseCommandCenter() {
  return <div dir="rtl" className="space-y-4 p-3 md:p-5 pb-8">
    <section className="rounded-3xl border border-teal-200 bg-gradient-to-l from-teal-50 via-white to-white p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-teal-800"><ClipboardCheck className="h-5 w-5" /><span className="text-xs font-black">مركز المشتريات الموحد</span></div>
          <h1 className="mt-1 text-2xl font-black text-slate-950">من الاحتياج إلى الاستلام — في مسار واحد</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">ابدأ بتنفيذ الطلبية. استخدم أدوات القرار والتحليل فقط عند الحاجة، ثم انتقل للاستلام والمطابقة بعد الاعتماد والإرسال للمورد.</p>
        </div>
        <Link to="/smart-purchase-receiving" className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-black text-white shadow-sm">فتح الاستلام والمطابقة</Link>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {STEPS.map((step) => <WorkflowStep key={step.n} step={step} />)}
      </div>
    </section>

    <section id="purchase-order-workspace" className="scroll-mt-4 rounded-2xl border-2 border-teal-200 bg-white p-2 md:p-3 shadow-sm">
      <div className="px-2 pb-3 pt-1">
        <h2 className="font-black text-lg">تنفيذ الطلبية</h2>
        <p className="mt-1 text-xs text-slate-500">رفع الملف، حساب الاحتياج، حدود الصنف والطلبية، مراجعة المورد، ثم الاعتماد والإرسال.</p>
      </div>
      <SmartPurchaseUnifiedCenter />
    </section>

    <DetailSection id="purchase-decision-tools" title="قرار الشراء والمسودة الذكية" description="افتح هذا الجزء لو محتاج دعم قرار قبل إنشاء الطلبية: تغيرات اليوم، رأس المال، أو مسودة آمنة.">
      <div className="space-y-4">
        <PurchaseExecutiveDecisionCenter />
        <PurchaseDecisionDailyChange />
        <SafePurchaseDraftBuilder />
      </div>
    </DetailSection>

    <DetailSection id="purchase-supplier-tools" title="أدوات الموردين المتقدمة" description="رفع وتجديد العروض، مقارنة البدائل، تقسيم الكمية بين أكثر من مورد، والتعلم من الأداء الفعلي.">
      <div className="space-y-4">
        <SupplierOfferImport />
        <SupplierDecisionAdvisor />
        <SupplierAllocationPlanner />
        <SupplierPerformanceLearning />
      </div>
    </DetailSection>

    <DetailSection id="purchase-control-tools" title="الميزانية والمخزون والتصريف" description="أدوات رقابية أعمق للدورة ورأس المال والرواكد والصلاحية، وليست مطلوبة لإتمام كل طلبية.">
      <div className="space-y-4">
        <PurchaseCycleBudgetGuard />
        <InventoryCapitalCommandCenter />
        <SmartClearanceEngine />
        <ClearanceOutcomeTracker />
      </div>
    </DetailSection>

    <DetailSection id="purchase-data-import" title="بيانات إضافية للتحليل" description="إضافة بيانات الربحية والصلاحية والـBatch عند الحاجة لتحليلات أعمق.">
      <InventoryIntelligenceImport />
    </DetailSection>
  </div>;
}
