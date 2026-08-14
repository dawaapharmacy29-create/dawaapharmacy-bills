import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/lib/useUserRole";
import OrderWorkspaceTabs from "./OrderWorkspaceTabs";
import OrderWorkspaceDashboard from "./OrderWorkspaceDashboard";
import OrderWorkspaceOrders from "./OrderWorkspaceOrders";
import OrderFormDialog from "./OrderFormDialog";
import OrderDetailDialog from "./OrderDetailDialog";
import OrderAnalyticsPerformance from "./OrderAnalyticsPerformance";
import OrderAnalyticsBranches from "./OrderAnalyticsBranches";
import OrderAnalyticsLeaders from "./OrderAnalyticsLeaders";
import OrderAlerts from "./OrderAlerts";
import useCustomerOrdersWorkspace from "./useCustomerOrdersWorkspace";

const ANALYTICS_TABS = [["performance", "الأداء"], ["branches", "الفروع"], ["leaders", "الأصناف والعملاء"]];

export default function CustomerOrdersWorkspace() {
  const { isManager, user } = useUserRole();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const w = useCustomerOrdersWorkspace({ isManager, user });
  const [showForm, setShowForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [analyticsTab, setAnalyticsTab] = useState("performance");
  const refresh = () => qc.invalidateQueries({ queryKey: ["customer-orders"] });

  useEffect(() => {
    const targetId = searchParams.get('order');
    if (!targetId || !w.orders?.length) return;
    const target = w.orders.find((order) => String(order.id) === String(targetId));
    if (target) {
      setSelectedOrder(target);
      w.setMainTab('orders');
    }
  }, [searchParams, w.orders]);

  const openOrder = (order) => {
    setSelectedOrder(order);
    const next = new URLSearchParams(searchParams);
    next.set('order', String(order.id));
    setSearchParams(next, { replace: true });
  };
  const closeOrder = () => {
    setSelectedOrder(null);
    const next = new URLSearchParams(searchParams);
    next.delete('order');
    setSearchParams(next, { replace: true });
  };

  return <div dir="rtl" className="p-3 md:p-5 space-y-4 max-w-[1500px] mx-auto">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center"><ShoppingBag className="w-5 h-5 text-white" /></div><div><h1 className="text-lg md:text-xl font-bold text-gray-900">طلبات العملاء</h1><p className="text-xs text-gray-500">كل مجموعة بيانات في تبويب مستقل وواضح</p></div></div>
      <div className="flex gap-2 w-full sm:w-auto"><OrderAlerts orders={w.orders} onOpen={openOrder} /><Button size="sm" onClick={() => setShowForm(true)} className="bg-teal-600 hover:bg-teal-700 gap-2 flex-1 sm:flex-none"><Plus className="w-4 h-4" /> طلب جديد</Button></div>
    </div>

    <OrderWorkspaceTabs value={w.mainTab} onChange={w.setMainTab} />
    {w.mainTab === "dashboard" && <OrderWorkspaceDashboard orders={w.orders} onOpen={openOrder} />}
    {w.mainTab === "orders" && <OrderWorkspaceOrders workspace={w} isManager={isManager} onSelect={openOrder} />}
    {w.mainTab === "followup" && <OrderWorkspaceOrders workspace={w} isManager={isManager} onSelect={openOrder} mode="followup" />}
    {w.mainTab === "analytics" && <div className="space-y-3">
      <div className="bg-white border rounded-2xl p-1.5 overflow-x-auto"><div className="grid grid-cols-3 min-w-[420px] gap-1.5">{ANALYTICS_TABS.map(([id, label]) => <button key={id} onClick={() => setAnalyticsTab(id)} className={`h-10 px-3 rounded-xl text-sm font-semibold transition ${analyticsTab === id ? "bg-teal-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>{label}</button>)}</div></div>
      {analyticsTab === "performance" && <OrderAnalyticsPerformance orders={w.orders} />}
      {analyticsTab === "branches" && <OrderAnalyticsBranches orders={w.orders} />}
      {analyticsTab === "leaders" && <OrderAnalyticsLeaders orders={w.orders} />}
    </div>}
    {w.mainTab === "archive" && <OrderWorkspaceOrders workspace={w} isManager={isManager} onSelect={openOrder} mode="archive" />}

    {showForm && <OrderFormDialog open={showForm} onOpenChange={setShowForm} teamMembers={w.teamMembers} onSaved={refresh} />}
    {selectedOrder && <OrderDetailDialog open={!!selectedOrder} onOpenChange={(v) => !v && closeOrder()} order={selectedOrder} teamMembers={w.teamMembers} isManager={isManager} onUpdated={(updated) => { setSelectedOrder(updated); refresh(); }} />}
  </div>;
}
