import { Link, useLocation, Outlet } from "react-router-dom";
import { LayoutDashboard, FileText, FilePlus2, Users, Receipt, Menu, LogOut, BarChart2, BarChart3, HandCoins, ClipboardList, ShieldCheck, UserCheck, FlaskConical, RotateCcw, PackageX, ShoppingBag, PackageSearch, Clock, FileSearch, AlertTriangle, Database, ArrowLeftRight, GitBranch, Activity, ListChecks, UserRoundCheck, BrainCircuit, PackageCheck, Landmark, Zap, Building2, Scale, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/lib/useUserRole";
import SmartAlerts from "@/components/layout/SmartAlerts";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";

const navGroups = [
  { key: 'overview', label: 'الرئيسية والتحليلات', icon: LayoutDashboard, items: [
    { path: '/', label: 'الرئيسية', icon: LayoutDashboard },
    { path: '/branch-performance', label: 'مقارنة وكفاءة الفروع', icon: Building2 },
    { path: '/sales-purchases-report', label: 'المبيعات مقابل المشتريات', icon: Scale },
    { path: '/reports', label: 'التقارير الإجمالية', icon: BarChart2 },
    { path: '/reports-branch', label: 'تقارير دواء شكري', icon: BarChart2 },
    { path: '/reports-branch?branch=دواء الشامي', label: 'تقارير دواء الشامي', icon: BarChart2 },
  ]},
  { key: 'purchases', label: 'المشتريات والطلبيات', icon: Zap, items: [
    { path: '/invoices/new', label: 'إدخال فاتورة سريع', icon: FilePlus2 },
    { path: '/invoices', label: 'فواتير الشراء', icon: FileText },
    { path: '/purchase-center', label: 'مركز الطلبية السريع', icon: Zap },
    { path: '/purchase-operations-review', label: 'مراجعة تشغيل الطلبيات', icon: ListChecks, adminOnly: true },
    { path: '/smart-purchase-orders', label: 'رفع وتحليل ملف الطلبية', icon: BrainCircuit },
    { path: '/smart-purchase-orders/manage', label: 'تعديل وعروض الموردين', icon: FileSearch },
    { path: '/smart-purchase-receiving', label: 'استلام ومطابقة الطلبيات', icon: PackageCheck },
    { path: '/smart-purchase-insights', label: 'تقييم وتحسين المشتريات', icon: BarChart3 },
    { path: '/purchase-workflow', label: 'مركز دورة المشتريات', icon: GitBranch },
    { path: '/replenishment', label: 'الأصناف المطلوبة', icon: PackageSearch },
  ]},
  { key: 'finance', label: 'الحسابات والخزنة', icon: Landmark, items: [
    { path: '/expenses', label: 'المصروفات', icon: Receipt },
    { path: '/returns', label: 'المرتجعات', icon: RotateCcw },
    { path: '/shift-delivery', label: 'تسليم الشيفت', icon: Clock },
    { path: '/treasury', label: 'الخزنة والعهد والتحويلات', icon: Landmark },
    { path: '/treasury-operations', label: 'رقابة وإقفال الخزنة', icon: ShieldCheck, adminOnly: true },
    { path: '/supplier-balances', label: 'أرصدة الموردين', icon: HandCoins },
    { path: '/branch-settlements', label: 'تسويات الفروع', icon: ArrowLeftRight, adminOnly: true },
    { path: '/supplier-balances-branch', label: 'أرصدة دواء شكري', icon: HandCoins },
    { path: '/supplier-balances-branch?branch=دواء الشامي', label: 'أرصدة دواء الشامي', icon: HandCoins },
  ]},
  { key: 'operations', label: 'التشغيل والمخزون', icon: PackageSearch, items: [
    { path: '/inventory', label: 'الراكد والأكسبير', icon: PackageX },
    { path: '/inventory-count', label: 'الجرد الدوري', icon: PackageSearch },
    { path: '/medicine-list', label: 'أدوية اللستة', icon: FlaskConical },
    { path: '/customer-orders', label: 'طلبات العملاء', icon: ShoppingBag },
    { path: '/pharmacy-orders', label: 'طلبات الصيدليات', icon: FlaskConical },
    { path: '/suppliers', label: 'الموردون', icon: Users },
  ]},
  { key: 'review', label: 'المراجعة والجودة', icon: ClipboardList, items: [
    { path: '/pending-invoices', label: 'انتظار المراجعة', icon: ClipboardList, badge: true },
    { path: '/invoices/quality', label: 'مراجعة وأخطاء الفواتير', icon: ListChecks },
    { path: '/review-needed-invoices', label: 'فواتير تحتاج مراجعة', icon: AlertTriangle },
    { path: '/activity-log', label: 'سجل العمليات', icon: ClipboardList },
  ]},
  { key: 'admin', label: 'الإدارة والنظام', icon: ShieldCheck, adminOnly: true, items: [
    { path: '/system-status', label: 'حالة النظام', icon: Activity },
    { path: '/data-review', label: 'مركز مراجعة البيانات', icon: Database },
    { path: '/security-audit', label: 'سجل الأمان', icon: ShieldCheck },
    { path: '/supplier-rules-backfill', label: 'تطبيق قواعد الموردين', icon: FileSearch },
    { path: '/doctor-account-coverage', label: 'تغطية حسابات الدكاترة', icon: UserRoundCheck },
    { path: '/user-management', label: 'المستخدمون والصلاحيات', icon: UserCheck },
    { path: '/team-members', label: 'فريق العمل', icon: UserCheck, visibleToAll: true },
    { path: '/team-merge', label: 'دمج الموظفين', icon: ArrowLeftRight },
  ]},
];

function BrandHeader({ compact = false }) { return <div className="border-b bg-teal-600 p-3"><div className="flex items-center gap-3"><div className={`${compact ? 'h-9 w-9' : 'h-12 w-12'} shrink-0 overflow-hidden rounded-xl bg-white p-1 shadow-sm`}><img src="/dawaa-logo.jpg" alt="صيدليات دواء" className="h-full w-full object-contain" /></div><div className="min-w-0"><h1 className="truncate font-bold text-white">صيدليات دواء</h1><p className="mt-0.5 text-xs text-teal-100">المشتريات والحسابات</p></div></div></div>; }

export default function AppLayout() {
  const location = useLocation(); const [mobileOpen, setMobileOpen] = useState(false); const { isAdmin } = useUserRole(); const { user, logout, isLoggingOut } = useAuth();
  const initialOpen = useMemo(() => { const found = navGroups.find((g) => g.items.some((i) => location.pathname === i.path.split('?')[0])); return found?.key || 'overview'; }, []);
  const [openGroups, setOpenGroups] = useState({ [initialOpen]: true });
  const { data: pendingInvoices = [] } = useQuery({ queryKey: ['pending-invoices-count'], queryFn: () => base44.entities.PurchaseInvoice.filter({ workflow_status: 'submitted' }, '-created_at', 500, 0), staleTime: 30000, retry: 1 });
  const pendingCount = pendingInvoices.length;
  const toggle = (key) => setOpenGroups((old) => ({ ...old, [key]: !old[key] }));
  const isActive = (path) => { const [pathname, query] = path.split('?'); return location.pathname === pathname && (!query || location.search === `?${query}`); };
  const visibleGroups = navGroups.filter((group) => !group.adminOnly || isAdmin || group.items.some((item) => item.visibleToAll));
  const renderNav = (closeMobile = false) => <div className="space-y-2">{visibleGroups.map((group) => {
    const items = group.items.filter((item) => (!group.adminOnly || isAdmin || item.visibleToAll) && (!item.adminOnly || isAdmin));
    const activeInside = items.some((item) => isActive(item.path)); const GroupIcon = group.icon;
    return <div key={group.key} className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <button type="button" onClick={() => toggle(group.key)} className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-sm font-bold transition-colors', activeInside ? 'bg-teal-50 text-teal-800' : 'text-gray-700 hover:bg-gray-50')}>
        <GroupIcon className="h-4 w-4"/><span className="flex-1 text-right">{group.label}</span><ChevronDown className={cn('h-4 w-4 transition-transform', openGroups[group.key] && 'rotate-180')}/>
      </button>
      {openGroups[group.key] && <div className="space-y-1 border-t bg-gray-50/50 p-2">{items.map((item) => <Link key={item.path} to={item.path} onClick={closeMobile ? () => setMobileOpen(false) : undefined} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors', isActive(item.path) ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-teal-700')}><item.icon className="h-3.5 w-3.5"/><span className="flex-1">{item.label}</span>{item.badge && pendingCount > 0 && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">{pendingCount}</span>}</Link>)}</div>}
    </div>;
  })}</div>;
  const logoutButton = (mobile = false) => <button type="button" disabled={isLoggingOut} onClick={() => { if (mobile) setMobileOpen(false); logout(); }} className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut className="h-4 w-4"/>{isLoggingOut ? 'جاري تسجيل الخروج...' : 'تسجيل الخروج'}</button>;
  return <div dir="rtl" className="flex min-h-screen bg-gray-50"><aside className="hidden w-64 flex-col border-l bg-white shadow-sm md:flex"><BrandHeader/><div className="border-b bg-gray-50 px-4 py-3"><p className="truncate text-sm font-bold text-gray-800">{user?.full_name || user?.username}</p><p className="truncate text-xs text-gray-500" dir="ltr">{user?.username}</p></div><nav className="flex-1 overflow-y-auto p-3">{renderNav()}</nav><div className="border-t p-3">{logoutButton()}</div></aside>
    <div className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-between bg-teal-600 px-3 py-2.5 shadow-sm md:hidden"><div className="flex items-center gap-2"><div className="h-9 w-9 overflow-hidden rounded-lg bg-white p-1"><img src="/dawaa-logo.jpg" alt="صيدليات دواء" className="h-full w-full object-contain"/></div><div><h1 className="text-sm font-bold text-white">صيدليات دواء</h1><p className="text-[10px] text-teal-100">المشتريات</p></div></div><button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-white"><Menu className="h-6 w-6"/></button></div>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="right" className="w-80 p-0" dir="rtl"><BrandHeader compact/><div className="border-b bg-gray-50 px-4 py-3"><p className="truncate text-sm font-bold text-gray-800">{user?.full_name || user?.username}</p><p className="truncate text-xs text-gray-500" dir="ltr">{user?.username}</p></div><nav className="h-[calc(100vh-165px)] overflow-y-auto p-3">{renderNav(true)}</nav><div className="border-t p-3">{logoutButton(true)}</div></SheetContent></Sheet>
    <main className="flex min-w-0 flex-1 flex-col pt-14 md:overflow-auto md:pt-0"><div className="flex justify-end px-4 pb-0 pt-3"><SmartAlerts/></div><div className="flex-1"><Outlet/></div></main></div>;
}