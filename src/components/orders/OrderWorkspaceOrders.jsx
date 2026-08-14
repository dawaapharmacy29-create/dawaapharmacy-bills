import OrderWorkspaceFilters from "./OrderWorkspaceFilters";
import OrderTable from "./OrderTable";

const TABS = [["action", "يحتاج إجراء"], ["ordered", "تم الطلب"], ["ready", "تم التوفير"], ["all", "كل النشط"]];

export default function OrderWorkspaceOrders({ workspace, isManager, onSelect, mode = "orders" }) {
  return <div className="space-y-3">
    {mode === "orders" && <div className="bg-white border rounded-2xl p-1.5 overflow-x-auto"><div className="grid grid-cols-4 min-w-[500px] gap-1.5">{TABS.map(([id, label]) => <button key={id} onClick={() => workspace.setOrderTab(id)} className={`h-9 rounded-lg text-xs font-semibold ${workspace.orderTab === id ? "bg-teal-50 text-teal-700 border border-teal-200" : "text-gray-500 hover:bg-gray-50"}`}>{label}</button>)}</div></div>}
    {mode === "followup" && <div className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-3"><h2 className="font-bold text-sm text-teal-900">متابعة التوفير والتنفيذ</h2><p className="text-xs text-teal-700 mt-1">طلبات البحث والشراء والنواقص والتوفير فقط.</p></div>}
    <OrderWorkspaceFilters state={workspace.filters} setState={workspace.setFilters} isManager={isManager} teamMembers={workspace.teamMembers} />
    <OrderTable orders={workspace.filteredOrders} isLoading={workspace.isLoading} onSelect={onSelect} onDelete={() => {}} isManager={false} />
  </div>;
}
