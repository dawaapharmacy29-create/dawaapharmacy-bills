import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/lib/useUserRole";
import OrderWorkspaceTabs from "./OrderWorkspaceTabs";
import OrderWorkspaceDashboard from "./OrderWorkspaceDashboard";
import OrderWorkspaceOrders from "./OrderWorkspaceOrders";
import OrderFormDialog from "./OrderFormDialog";
import OrderDetailDialog from "./OrderDetailDialog";
import OrderAnalytics from "./OrderAnalytics";
import OrderAlerts from "./OrderAlerts";
import useCustomerOrdersWorkspace from "./useCustomerOrdersWorkspace";

export default function CustomerOrdersWorkspace() {
  const { isManager, user } = useUserRole();
  const qc = useQueryClient();
  const w = useCustomerOrdersWorkspace({ isManager, user });
  const [showForm, setShowForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["customer-orders"] });

  return <div dir="rtl" className="p-3 md:p-5 space-y-4 max-w-[1500px] mx-auto">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center"><ShoppingBag className="w-5 h-5 text-white" /></div><div><h1 className="text-lg md:text-xl font-bold text-gray-900">طلبات العملاء</h1><p className="text-xs text-gray-500">كل مجموعة بيانات في تبويب مستقل وواضح</p></div></div>
      <div className="flex gap-2 w-full sm:w-auto"><OrderAlerts orders={w.orders} /><Button size="sm" onClick={() => setShowForm(true)} className="bg-teal-600 hover:bg-teal-700 gap-2 flex-1 sm:flex-none"><Plus className="w-4 h-4" /> طلب جديد</Button></div>
    </div>

    <OrderWorkspaceTabs value={w.mainTab} onChange={w.setMainTab} />
    {w.mainTab === "dashboard" && <OrderWorkspaceDashboard orders={w.orders} onOpen={setSelectedOrder} />}
    {w.mainTab === "orders" && <OrderWorkspaceOrders workspace={w} isManager={isManager} onSelect={setSelectedOrder} />}
    {w.mainTab === "followup" && <OrderWorkspaceOrders workspace={w} isManager={isManager} onSelect={setSelectedOrder} mode="followup" />}
    {w.mainTab === "analytics" && <OrderAnalytics orders={w.orders} />}
    {w.mainTab === "archive" && <OrderWorkspaceOrders workspace={w} isManager={isManager} onSelect={setSelectedOrder} mode="archive" />}

    {showForm && <OrderFormDialog open={showForm} onOpenChange={setShowForm} teamMembers={w.teamMembers} onSaved={refresh} />}
    {selectedOrder && <OrderDetailDialog open={!!selectedOrder} onOpenChange={(v) => !v && setSelectedOrder(null)} order={selectedOrder} teamMembers={w.teamMembers} isManager={isManager} onUpdated={(updated) => { setSelectedOrder(updated); refresh(); }} />}
  </div>;
}
