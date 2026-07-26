import { Link, useLocation, Outlet } from "react-router-dom";
import { LayoutDashboard, FileText, FilePlus2, Users, Receipt, Menu, LogOut, BarChart2, HandCoins, ClipboardList, ShieldCheck, UserCheck, FlaskConical, RotateCcw, PackageX, ShoppingBag, PackageSearch, Clock, FileSearch, AlertTriangle, Database, ArrowLeftRight, GitBranch, Activity, ListChecks, UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/lib/useUserRole";
import SmartAlerts from "@/components/layout/SmartAlerts";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";

const navItems = [
  { path: "/", label: "الرئيسية", icon: LayoutDashboard },
  { path: "/system-status", label: "حالة النظام", icon: Activity, adminOnly: true },
  { path: "/invoices/new", label: "إدخال فاتورة سريع", icon: FilePlus2, teal: true },
  { path: "/purchase-workflow", label: "مركز دورة المشتريات", icon: GitBranch, emerald: true },
  { path: "/invoices", label: "فواتير الشراء", icon: FileText },
  { path: "/invoices/quality", label: "جودة الفواتير", icon: ListChecks, amber: true },
  { path: "/pending-invoices", label: "انتظار المراجعة", icon: ClipboardList, badge: true },
  { path: "/medicine-list", label: "أدوية اللسته", icon: FlaskConical, gold: true },
  { path: "/expenses", label: "المصروفات", icon: Receipt },
  { path: "/returns", label: "المرتجعات", icon: RotateCcw, pink: true },
  { path: "/inventory", label: "الراكد والأكسبير", icon: PackageX, dark: true },
  { path: "/inventory-count", label: "الجرد الدوري", icon: PackageSearch, cyan: true },
  { path: "/customer-orders", label: "طلبات العملاء", icon: ShoppingBag, teal: true },
  { path: "/pharmacy-orders", label: "طلبات الصيدليات", icon: FlaskConical, violet: true },
  { path: "/replenishment", label: "قائمة الأصناف المطلوبة", icon: PackageSearch, emerald: true },
  { path: "/shift-delivery", label: "تسليم الشيفت", icon: Clock, purple: true },
  { path: "/suppliers", label: "الموردين", icon: Users },
  { path: "/reports", label: "التقارير (إجمالي)", icon: BarChart2 },
  { path: "/reports-branch", label: "تقارير دواء شكري", icon: BarChart2, indent: true },
  { path: "/reports-branch?branch=دواء الشامي", label: "تقارير دواء الشامي", icon: BarChart2, indent: true },
  { path: "/supplier-balances", label: "أرصدة الموردين (إجمالي)", icon: HandCoins },
  { path: "/branch-settlements", label: "تسويات الفروع", icon: ArrowLeftRight, adminOnly: true },
  { path: "/supplier-balances-branch", label: "أرصدة دواء شكري", icon: HandCoins, indent: true },
  { path: "/supplier-balances-branch?branch=دواء الشامي", label: "أرصدة دواء الشامي", icon: HandCoins, indent: true },
  { path: "/activity-log", label: "سجل العمليات", icon: ClipboardList },
  { path: "/review-needed-invoices", label: "فواتير تحتاج مراجعة", icon: AlertTriangle, amber: true },
  { path: "/data-review", label: "مركز مراجعة البيانات", icon: Database, adminOnly: true },
  { path: "/security-audit", label: "سجل الأمان", icon: ShieldCheck, adminOnly: true },
  { path: "/supplier-rules-backfill", label: "تطبيق قواعد الموردين", icon: FileSearch, adminOnly: true },
  { path: "/doctor-account-coverage", label: "تغطية حسابات الدكاترة", icon: UserRoundCheck, adminOnly: true },
  { path: "/user-management", label: "المستخدمين والصلاحيات", icon: UserCheck, adminOnly: true },
  { path: "/team-members", label: "فريق العمل", icon: UserCheck },
  { path: "/team-merge", label: "دمج الموظفين", icon: ArrowLeftRight, adminOnly: true },
];

function BrandHeader({ compact = false }) {
  return (
    <div className="border-b bg-teal-600 p-3">
      <div className="flex items-center gap-3">
        <div className={`${compact ? 'h-9 w-9' : 'h-12 w-12'} shrink-0 overflow-hidden rounded-xl bg-white p-1 shadow-sm`}>
          <img src="/dawaa-logo.jpg" alt="صيدليات دواء" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-bold text-white">صيدليات دواء</h1>
          <p className="mt-0.5 text-xs text-teal-100">المشتريات والحسابات</p>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { isAdmin } = useUserRole();
  const { user, logout, isLoggingOut } = useAuth();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["pending-invoices-count"],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ status: "انتظار المراجعة" }),
    staleTime: 30000,
    retry: 1,
  });
  const pendingCount = pendingInvoices.length;

  const renderNav = (closeMobile = false) => visibleNavItems.map((item) => {
    const pathOnly = item.path.split("?")[0];
    const isActive = location.pathname === pathOnly && (item.path === pathOnly || location.search === `?${item.path.split("?")[1] || ""}`);
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={closeMobile ? () => setOpen(false) : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
          item.indent ? "px-2 py-2 mr-3" : "px-3 py-2.5",
          item.gold ? "bg-yellow-50 text-yellow-700 border border-yellow-300"
            : item.pink ? "bg-pink-50 text-pink-700 border border-pink-200"
            : item.dark ? "bg-gray-900 text-white border border-gray-700"
            : item.teal ? "bg-teal-600 text-white border border-teal-700"
            : item.cyan ? "bg-cyan-600 text-white border border-cyan-700"
            : item.violet ? "bg-violet-600 text-white border border-violet-700"
            : item.emerald ? "bg-emerald-600 text-white border border-emerald-700"
            : item.purple ? "bg-purple-600 text-white border border-purple-700"
            : item.amber ? "bg-amber-50 text-amber-700 border border-amber-200"
            : isActive ? "bg-teal-50 text-teal-700"
            : item.indent ? "text-gray-500 hover:bg-gray-100 text-xs"
            : "text-gray-600 hover:bg-gray-100"
        )}
      >
        <item.icon className={cn(item.indent ? "w-3 h-3" : "w-4 h-4")} />
        <span className="flex-1">{item.label}</span>
        {item.badge && pendingCount > 0 && <span className="rounded-full bg-yellow-400 px-1.5 py-0.5 text-xs font-bold text-yellow-900">{pendingCount}</span>}
      </Link>
    );
  });

  const logoutButton = (mobile = false) => (
    <button
      type="button"
      disabled={isLoggingOut}
      onClick={() => {
        if (mobile) setOpen(false);
        logout();
      }}
      className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut className="w-4 h-4" /> {isLoggingOut ? "جاري تسجيل الخروج..." : "تسجيل الخروج"}
    </button>
  );

  return (
    <div dir="rtl" className="flex min-h-screen bg-gray-50">
      <aside className="hidden md:flex flex-col w-60 bg-white border-l shadow-sm">
        <BrandHeader />
        <div className="px-4 py-3 border-b bg-gray-50">
          <p className="text-sm font-bold text-gray-800 truncate">{user?.full_name || user?.username}</p>
          <p className="text-xs text-gray-500 truncate" dir="ltr">{user?.username}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">{renderNav()}</nav>
        <div className="p-3 border-t">{logoutButton()}</div>
      </aside>

      <div className="md:hidden fixed top-0 right-0 left-0 z-[60] bg-teal-600 flex items-center justify-between px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 overflow-hidden rounded-lg bg-white p-1"><img src="/dawaa-logo.jpg" alt="صيدليات دواء" className="h-full w-full object-contain" /></div>
          <div><h1 className="text-white font-bold text-sm">صيدليات دواء</h1><p className="text-teal-100 text-[10px]">المشتريات</p></div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="text-white p-2 active:bg-teal-500 rounded-lg"><Menu className="w-6 h-6" /></button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72 p-0" dir="rtl">
          <BrandHeader compact />
          <div className="px-4 py-3 border-b bg-gray-50">
            <p className="text-sm font-bold text-gray-800 truncate">{user?.full_name || user?.username}</p>
            <p className="text-xs text-gray-500 truncate" dir="ltr">{user?.username}</p>
          </div>
          <nav className="overflow-y-auto p-3 space-y-1 h-[calc(100vh-165px)]">{renderNav(true)}</nav>
          <div className="p-3 border-t">{logoutButton(true)}</div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 md:overflow-auto pt-14 md:pt-0 flex flex-col min-w-0">
        <div className="px-4 pt-3 pb-0 flex justify-end"><SmartAlerts /></div>
        <div className="flex-1"><Outlet /></div>
      </main>
    </div>
  );
}
