import { Link, useLocation, Outlet } from "react-router-dom";
import { LayoutDashboard, FileText, Users, Receipt, Menu, BarChart2, HandCoins, ClipboardList, ShieldCheck, UserCheck, FlaskConical, RotateCcw, PackageX, ShoppingBag, PackageSearch, Clock, FileSearch, AlertTriangle, Database, ArrowLeftRight, GitBranch } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/lib/useUserRole";
import SmartAlerts from "@/components/layout/SmartAlerts";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const navItems = [
  { path: "/", label: "الرئيسية", icon: LayoutDashboard },
  { path: "/purchase-workflow", label: "مركز دورة المشتريات", icon: GitBranch, emerald: true },
  { path: "/invoices", label: "فواتير الشراء", icon: FileText },
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
  { path: "/user-management", label: "المستخدمين والصلاحيات", icon: UserCheck },
  { path: "/team-members", label: "فريق العمل", icon: UserCheck },
  { path: "/team-merge", label: "دمج الموظفين", icon: ArrowLeftRight, adminOnly: true },
];

export default function AppLayout() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { isAdmin } = useUserRole();
  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["pending-invoices-count"],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ status: "انتظار المراجعة" }),
    staleTime: 30000,
  });
  const pendingCount = pendingInvoices.length;

  return (
    <div dir="rtl" className="flex min-h-screen bg-gray-50">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-l shadow-sm">
        <div className="p-4 border-b bg-teal-600">
          <h1 className="text-white font-bold text-lg">صيدليات دواء</h1>
          <p className="text-teal-100 text-xs mt-0.5">مشتريات</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {visibleNavItems.map((item) => {
            const pathOnly = item.path.split("?")[0];
            const isActive = location.pathname === pathOnly && (item.path === pathOnly || location.search === `?${item.path.split("?")[1] || ""}`);
            return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                item.indent ? "px-2 py-2 mr-3" : "px-3 py-2.5",
                item.gold
                  ? "bg-yellow-50 text-yellow-700 border border-yellow-300"
                  : item.pink
                  ? "bg-pink-50 text-pink-700 border border-pink-200"
                  : item.dark
                  ? "bg-gray-900 text-white border border-gray-700"
                  : item.teal
                  ? "bg-teal-600 text-white border border-teal-700"
                  : item.cyan
                  ? "bg-cyan-600 text-white border border-cyan-700"
                  : item.violet
                  ? "bg-violet-600 text-white border border-violet-700"
                  : item.emerald
                  ? "bg-emerald-600 text-white border border-emerald-700"
                  : item.purple
                  ? "bg-purple-600 text-white border border-purple-700"
                  : isActive
                  ? "bg-teal-50 text-teal-700"
                  : item.indent
                  ? "text-gray-500 hover:bg-gray-100 text-xs"
                  : "text-gray-600 hover:bg-gray-100"
                  )}
                  >
                  <item.icon className={cn(item.indent ? "w-3 h-3" : "w-4 h-4", item.gold && "text-yellow-500", item.pink && "text-pink-500", item.dark && "text-white", item.teal && "text-white", item.cyan && "text-white", item.violet && "text-white", item.emerald && "text-white", item.purple && "text-white")} />
              <span className="flex-1">{item.label}</span>
              {item.badge && pendingCount > 0 && (
                <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
              )}
            </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 right-0 left-0 z-[60] bg-teal-600 flex items-center justify-between px-4 py-3">
        <p className="text-teal-100 text-sm">مشتريات</p>
        <h1 className="text-white font-bold">صيدليات دواء</h1>
        <button onClick={() => setOpen(true)} className="text-white p-2 -m-2 active:bg-teal-500 rounded-lg">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Mobile Nav Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72 p-0 data-[state=open]:duration-150 data-[state=closed]:duration-150" dir="rtl">
          <div className="p-4 border-b bg-teal-600">
            <h1 className="text-white font-bold text-lg">صيدليات دواء</h1>
            <p className="text-teal-100 text-xs mt-0.5">مشتريات</p>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1 h-[calc(100vh-64px)]">
            {visibleNavItems.map((item) => {
              const pathOnly = item.path.split("?")[0];
              const isActive = location.pathname === pathOnly && (item.path === pathOnly || location.search === `?${item.path.split("?")[1] || ""}`);
              return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                  item.indent ? "px-2 py-2 mr-3" : "px-3 py-2.5",
                  item.gold
                    ? "bg-yellow-50 text-yellow-700 border border-yellow-300"
                    : item.pink
                    ? "bg-pink-50 text-pink-700 border border-pink-200"
                    : item.dark
                      ? "bg-gray-900 text-white border border-gray-700"
                      : item.teal
                      ? "bg-teal-600 text-white border border-teal-700"
                      : item.cyan
                      ? "bg-cyan-600 text-white border border-cyan-700"
                      : item.violet
                       ? "bg-violet-600 text-white border border-violet-700"
                       : item.emerald
                       ? "bg-emerald-600 text-white border border-emerald-700"
                       : item.purple
                       ? "bg-purple-600 text-white border border-purple-700"
                       : isActive
                       ? "bg-teal-50 text-teal-700"
                       : item.indent
                       ? "text-gray-500 hover:bg-gray-100 text-xs"
                       : "text-gray-600 hover:bg-gray-100"
                      )}
                      >
                      <item.icon className={cn(item.indent ? "w-3 h-3" : "w-4 h-4", item.gold && "text-yellow-500", item.pink && "text-pink-500", item.dark && "text-white", item.teal && "text-white", item.cyan && "text-white", item.violet && "text-white", item.emerald && "text-white", item.purple && "text-white")} />
                <span className="flex-1">{item.label}</span>
                {item.badge && pendingCount > 0 && (
                  <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
                )}
              </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 md:overflow-auto pt-14 md:pt-0 flex flex-col">
        {/* Alerts bar */}
        <div className="px-4 pt-3 pb-0 flex justify-end">
          <SmartAlerts />
        </div>
        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}