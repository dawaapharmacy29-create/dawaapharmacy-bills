import { Link, useLocation, Outlet } from "react-router-dom";
import {
  LayoutDashboard, FileText, FilePlus2, Users, Receipt, Menu, LogOut, BarChart2, BarChart3,
  HandCoins, ClipboardList, ShieldCheck, UserCheck, FlaskConical, RotateCcw, PackageX,
  ShoppingBag, PackageSearch, Clock, FileSearch, AlertTriangle, Database, ArrowLeftRight,
  GitBranch, Activity, ListChecks, UserRoundCheck, BrainCircuit, PackageCheck, Landmark,
  Zap, Building2, Scale, ChevronDown, Search, X, Layers3, BadgeCheck, DatabaseZap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44, base44ReviewApi } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/lib/useUserRole";
import SmartAlerts from "@/components/layout/SmartAlerts";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";

const NAV_STORAGE_KEY = "dawaa_sidebar_open_group";

const navGroups = [
  {
    key: "home", label: "الرئيسية والمتابعة", icon: LayoutDashboard,
    sections: [
      { label: "نظرة عامة", items: [
        { path: "/", label: "الرئيسية", icon: LayoutDashboard },
        { path: "/daily-tasks", label: "مهام اليوم", icon: ListChecks },
        { path: "/branch-performance", label: "مقارنة وكفاءة الفروع", icon: Building2 },
        { path: "/sales-purchases-report", label: "المبيعات مقابل المشتريات", icon: Scale },
      ]},
      { label: "التقارير", items: [
        { path: "/reports-center", label: "مركز التقارير", icon: BarChart3 },
        { path: "/reports", label: "التقارير الإجمالية", icon: BarChart2 },
        { path: "/reports-branch", label: "تقارير الفروع", icon: BarChart3 },
      ]},
    ],
  },
  {
    key: "purchases", label: "المشتريات والفواتير", icon: Zap,
    sections: [
      { label: "الفواتير", items: [
        { path: "/invoice-center", label: "مركز الفواتير الموحد", icon: Layers3 },
        { path: "/invoices/new", label: "إدخال فاتورة سريع", icon: FilePlus2 },
        { path: "/invoices", label: "فواتير الشراء — عرض سريع", icon: FileText },
        { path: "/invoices/manage", label: "فواتير الشراء — تفصيلي وفلاتر", icon: FileSearch },
        { path: "/pending-invoices", label: "انتظار المراجعة", icon: ClipboardList, badgeKey: "invoices" },
        { path: "/invoices/quality", label: "مراجعة وأخطاء الفواتير", icon: ListChecks },
      ]},
      { label: "الأداة الموحدة (ابدأ من هنا)", items: [
        { path: "/purchase-center", label: "مركز الطلبية السريع", icon: Zap },
      ]},
      { label: "خطوات الطلبية بالتفصيل", items: [
        { path: "/smart-purchase-orders", label: "1. رفع وتحليل ملف الطلبية", icon: BrainCircuit },
        { path: "/smart-purchase-orders/manage", label: "2. مراجعة العروض واعتماد الطلبية", icon: FileSearch },
        { path: "/smart-purchase-receiving", label: "3. الاستلام والمطابقة", icon: PackageCheck },
        { path: "/smart-purchase-insights", label: "4. تقييم الأداء بعد التنفيذ", icon: BarChart3 },
      ]},
      { label: "مراقبة ومراجعة الطلبيات", items: [
        { path: "/purchase-workflow", label: "متابعة الاختناقات والنواقص", icon: GitBranch },
        { path: "/purchase-operations-review", label: "مراجعة شاملة وSLA", icon: ListChecks, adminOnly: true },
      ]},
      { label: "الطلبات", items: [
        { path: "/replenishment", label: "الأصناف المطلوبة", icon: PackageSearch },
        { path: "/pharmacy-orders", label: "طلبات الصيدليات", icon: FlaskConical },
        { path: "/customer-orders", label: "طلبات العملاء", icon: ShoppingBag },
      ]},
    ],
  },
  {
    key: "finance", label: "الحسابات والتشغيل", icon: Landmark,
    sections: [
      { label: "دورة الشيفت والخزنة", items: [
        { path: "/operations-center", label: "مركز التشغيل والخزنة", icon: Landmark },
        { path: "/shift-delivery", label: "تسجيل وتسليم الشيفت", icon: Clock },
        { path: "/treasury/shift-review", label: "مراجعة واعتماد الشيفتات", icon: BadgeCheck, managerOnly: true, badgeKey: "shifts" },
        { path: "/treasury", label: "الخزنة — العمليات اليومية", icon: Landmark },
        { path: "/treasury-operations", label: "الخزنة — الرقابة والإقفال (أدمن)", icon: ShieldCheck, adminOnly: true },
      ]},
      { label: "الحركات المالية", items: [
        { path: "/expenses", label: "المصروفات", icon: Receipt },
        { path: "/returns", label: "المرتجعات", icon: RotateCcw },
        { path: "/supplier-balances", label: "أرصدة الموردين", icon: HandCoins },
        { path: "/branch-settlements", label: "تسويات الفروع", icon: ArrowLeftRight, adminOnly: true },
      ]},
      { label: "المخزون والموردون", items: [
        { path: "/suppliers", label: "الموردون", icon: Users },
        { path: "/inventory", label: "الراكد والأكسبير", icon: PackageX },
        { path: "/inventory-count", label: "الجرد الدوري", icon: PackageSearch },
        { path: "/medicine-list", label: "أدوية اللستة", icon: FlaskConical },
      ]},
    ],
  },
  {
    key: "quality", label: "المراجعة والجودة", icon: ClipboardList,
    sections: [
      { label: "متابعة الجودة", items: [
        { path: "/review-needed-invoices", label: "فواتير تحتاج مراجعة", icon: AlertTriangle },
        { path: "/data-review", label: "مركز مراجعة البيانات", icon: Database, adminOnly: true },
        { path: "/base44-sync-review", label: "مراجعة مزامنة Base44", icon: DatabaseZap, adminOnly: true, badgeKey: "base44Sync" },
        { path: "/activity-log", label: "سجل العمليات", icon: ClipboardList },
        { path: "/security-audit", label: "سجل الأمان", icon: ShieldCheck, adminOnly: true },
      ]},
    ],
  },
  {
    key: "admin", label: "الإدارة والإعدادات", icon: ShieldCheck,
    sections: [
      { label: "المستخدمون", items: [
        { path: "/team-members", label: "فريق العمل", icon: UserCheck },
        { path: "/user-management", label: "المستخدمون والصلاحيات", icon: Users, adminOnly: true },
        { path: "/doctor-account-coverage", label: "تغطية حسابات الدكاترة", icon: UserRoundCheck, adminOnly: true },
        { path: "/team-merge", label: "دمج الموظفين", icon: ArrowLeftRight, adminOnly: true },
      ]},
      { label: "النظام والصيانة", items: [
        { path: "/system-status", label: "حالة النظام", icon: Activity, adminOnly: true },
        { path: "/supplier-rules-backfill", label: "تطبيق قواعد الموردين", icon: FileSearch, adminOnly: true },
      ]},
    ],
  },
];

const quickLinks = [
  { path: "/", label: "الرئيسية", icon: LayoutDashboard },
  { path: "/daily-tasks", label: "مهام اليوم", icon: ListChecks },
  { path: "/invoice-center", label: "مركز الفواتير", icon: Layers3 },
  { path: "/invoices/new", label: "فاتورة جديدة", icon: FilePlus2 },
  { path: "/pending-invoices", label: "مراجعة الفواتير", icon: ClipboardList, badgeKey: "invoices" },
  { path: "/shift-delivery", label: "تسليم الشيفت", icon: Clock },
];

function BrandHeader({ compact = false }) {
  return <div className="border-b bg-teal-600 p-3"><div className="flex items-center gap-3"><div className={`${compact ? "h-9 w-9" : "h-12 w-12"} shrink-0 overflow-hidden rounded-xl bg-white p-1 shadow-sm`}><img src="/dawaa-logo.jpg" alt="صيدليات دواء" className="h-full w-full object-contain" /></div><div className="min-w-0"><h1 className="truncate font-bold text-white">صيدليات دواء</h1><p className="mt-0.5 text-xs text-teal-100">المشتريات والحسابات</p></div></div></div>;
}

export default function AppLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { isAdmin, isManager } = useUserRole();
  const canReviewShifts = isAdmin || isManager;
  const { user, logout, isLoggingOut } = useAuth();

  const visibleGroups = useMemo(() => navGroups.map((group) => ({
    ...group,
    sections: group.sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => (!item.adminOnly || isAdmin) && (!item.managerOnly || canReviewShifts)),
    })).filter((section) => section.items.length),
  })).filter((group) => group.sections.length), [isAdmin, canReviewShifts]);

  const groupForPath = useMemo(() => visibleGroups.find((group) => group.sections.some((section) => section.items.some((item) => location.pathname === item.path.split("?")[0])))?.key || "home", [location.pathname, visibleGroups]);
  const [openGroup, setOpenGroup] = useState(() => localStorage.getItem(NAV_STORAGE_KEY) || groupForPath);

  useEffect(() => {
    setOpenGroup(groupForPath);
    localStorage.setItem(NAV_STORAGE_KEY, groupForPath);
  }, [groupForPath]);

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["pending-invoices-count"],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ workflow_status: "submitted" }, "-created_at", 500, 0),
    staleTime: 30000,
    retry: 1,
  });

  const { data: pendingShifts = [] } = useQuery({
    queryKey: ["pending-shifts-navigation-count"],
    queryFn: async () => {
      const rows = await base44.entities.ShiftDelivery.list("-shift_date", 500, 0);
      return rows.filter((shift) => ["pending", "pending_review", "returned"].includes(shift.treasury_status || "pending"));
    },
    enabled: canReviewShifts,
    staleTime: 30000,
    refetchInterval: 60000,
    retry: 1,
  });

  const { data: base44SyncSummary } = useQuery({
    queryKey: ["base44-sync-pending-count"],
    queryFn: () => base44ReviewApi.pendingList({ status: "pending", limit: 1 }),
    enabled: isAdmin,
    staleTime: 30000,
    refetchInterval: 60000,
    retry: 1,
  });

  const badgeCounts = { invoices: pendingInvoices.length, shifts: pendingShifts.length, base44Sync: Number(base44SyncSummary?.pending_total || 0) };

  const isActive = (path) => {
    const [pathname, query] = path.split("?");
    return location.pathname === pathname && (!query || location.search === `?${query}`);
  };

  const chooseGroup = (key) => {
    const next = openGroup === key ? "" : key;
    setOpenGroup(next);
    localStorage.setItem(NAV_STORAGE_KEY, next);
  };

  const renderLink = (item, closeMobile = false, compact = false) => {
    const badgeValue = item.badgeKey ? Number(badgeCounts[item.badgeKey] || 0) : 0;
    return <Link key={item.path} to={item.path} onClick={closeMobile ? () => setMobileOpen(false) : undefined}
      className={cn("flex items-center gap-2 rounded-lg transition-colors", compact ? "px-2 py-2 text-[11px]" : "px-3 py-2 text-xs", isActive(item.path) ? "bg-teal-600 font-bold text-white shadow-sm" : "text-gray-600 hover:bg-white hover:text-teal-700")}>
      <item.icon className="h-3.5 w-3.5 shrink-0"/><span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badgeValue > 0 && <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", isActive(item.path) ? "bg-white/20 text-white" : "bg-amber-400 text-amber-950")}>{badgeValue}</span>}
    </Link>;
  };

  const filteredSearchItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return visibleGroups.flatMap((group) => group.sections.flatMap((section) => section.items.map((item) => ({ ...item, groupLabel: group.label })))).filter((item) => item.label.toLowerCase().includes(q)).slice(0, 12);
  }, [search, visibleGroups]);

  const renderNav = (closeMobile = false) => <div className="space-y-3">
    <div className="grid grid-cols-2 gap-1.5 rounded-xl border bg-gray-50 p-2">
      {quickLinks.filter((item) => (!item.adminOnly || isAdmin) && (!item.managerOnly || canReviewShifts)).map((item) => renderLink(item, closeMobile, true))}
    </div>

    <div className="relative">
      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"/>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن صفحة..." className="w-full rounded-xl border bg-white py-2.5 pl-9 pr-9 text-xs outline-none focus:border-teal-500" />
      {search && <button onClick={() => setSearch("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X className="h-4 w-4"/></button>}
    </div>

    {search ? <div className="space-y-1 rounded-xl border bg-gray-50 p-2">
      {filteredSearchItems.length ? filteredSearchItems.map((item) => renderLink(item, closeMobile)) : <p className="p-4 text-center text-xs text-gray-400">لا توجد صفحة بهذا الاسم</p>}
    </div> : <div className="space-y-2">{visibleGroups.map((group) => {
      const activeInside = group.sections.some((section) => section.items.some((item) => isActive(item.path)));
      const GroupIcon = group.icon;
      const opened = openGroup === group.key;
      const itemCount = group.sections.reduce((sum, section) => sum + section.items.length, 0);
      return <div key={group.key} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <button type="button" onClick={() => chooseGroup(group.key)} className={cn("flex w-full items-center gap-2 px-3 py-3 text-sm font-bold transition-colors", activeInside ? "bg-teal-50 text-teal-800" : "text-gray-700 hover:bg-gray-50")}>
          <GroupIcon className="h-4 w-4"/><span className="flex-1 text-right">{group.label}</span><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">{itemCount}</span><ChevronDown className={cn("h-4 w-4 transition-transform", opened && "rotate-180")}/>
        </button>
        {opened && <div className="space-y-3 border-t bg-gray-50/60 p-2.5">{group.sections.map((section) => <div key={section.label}>
          <div className="mb-1.5 flex items-center gap-2 px-2 text-[10px] font-bold text-gray-400"><Layers3 className="h-3 w-3"/>{section.label}</div>
          <div className="space-y-1">{section.items.map((item) => renderLink(item, closeMobile))}</div>
        </div>)}</div>}
      </div>;
    })}</div>}
  </div>;

  const logoutButton = (mobile = false) => <button type="button" disabled={isLoggingOut} onClick={() => { if (mobile) setMobileOpen(false); logout(); }} className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut className="h-4 w-4"/>{isLoggingOut ? "جاري تسجيل الخروج..." : "تسجيل الخروج"}</button>;

  return <div dir="rtl" className="flex min-h-screen bg-gray-50">
    <aside className="hidden w-72 flex-col border-l bg-white shadow-sm md:flex">
      <BrandHeader/>
      <div className="border-b bg-gray-50 px-4 py-3"><p className="truncate text-sm font-bold text-gray-800">{user?.full_name || user?.username}</p><p className="truncate text-xs text-gray-500" dir="ltr">{user?.username}</p></div>
      <nav className="flex-1 overflow-y-auto p-3">{renderNav()}</nav>
      <div className="border-t p-3">{logoutButton()}</div>
    </aside>

    <div className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-between bg-teal-600 px-3 py-2.5 shadow-sm md:hidden"><div className="flex items-center gap-2"><div className="h-9 w-9 overflow-hidden rounded-lg bg-white p-1"><img src="/dawaa-logo.jpg" alt="صيدليات دواء" className="h-full w-full object-contain"/></div><div><h1 className="text-sm font-bold text-white">صيدليات دواء</h1><p className="text-[10px] text-teal-100">المشتريات</p></div></div><button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-white"><Menu className="h-6 w-6"/></button></div>

    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="right" className="w-80 p-0" dir="rtl"><BrandHeader compact/><div className="border-b bg-gray-50 px-4 py-3"><p className="truncate text-sm font-bold text-gray-800">{user?.full_name || user?.username}</p><p className="truncate text-xs text-gray-500" dir="ltr">{user?.username}</p></div><nav className="h-[calc(100vh-165px)] overflow-y-auto p-3">{renderNav(true)}</nav><div className="border-t p-3">{logoutButton(true)}</div></SheetContent></Sheet>

    <main className="flex min-w-0 flex-1 flex-col pt-14 md:overflow-auto md:pt-0"><div className="flex justify-end px-4 pb-0 pt-3"><SmartAlerts/></div><div className="flex-1"><Outlet/></div></main>
  </div>;
}