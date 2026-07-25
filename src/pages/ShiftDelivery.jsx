import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useUserRole } from "@/lib/useUserRole";
import ShiftDeliveryForm from "@/components/shift/ShiftDeliveryForm";
import ShiftDeliveryHistory from "@/components/shift/ShiftDeliveryHistory";
import ShiftDeliveryStats from "@/components/shift/ShiftDeliveryStats";
import ShiftDeliveryReport from "@/components/shift/ShiftDeliveryReport";
import ExpenseItemsTab from "@/components/shift/ExpenseItemsTab";
import { cn } from "@/lib/utils";

export default function ShiftDelivery() {
  const { isAdmin, isManager } = useUserRole();
  const canViewAll = isAdmin || isManager;
  const [activeTab, setActiveTab] = useState("new");

  const { data: deliveries = [] } = useQuery({
    queryKey: ["shift-deliveries"],
    queryFn: async () => {
      const PAGE = 500; let all = []; let page = 0;
      while (true) {
        const batch = await base44.entities.ShiftDelivery.list("-shift_date", PAGE, page * PAGE);
        all = [...all, ...batch];
        if (batch.length < PAGE) break;
        page++;
      }
      return all;
    },
    staleTime: 30000,
  });

  const tabs = canViewAll
    ? [
        { key: "new", label: "تسليم جديد" },
        { key: "history", label: "التسليمات" },
        { key: "stats", label: "الإحصائيات" },
        { key: "report", label: "التقرير" },
        { key: "items", label: "بنود المصروفات" },
      ]
    : [{ key: "new", label: "تسليم جديد" }];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === tab.key
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "new" && <ShiftDeliveryForm onSaved={() => canViewAll && setActiveTab("history")} />}
      {activeTab === "history" && canViewAll && (
        <ShiftDeliveryHistory deliveries={deliveries} onNewShift={() => setActiveTab("new")} />
      )}
      {activeTab === "stats" && canViewAll && <ShiftDeliveryStats deliveries={deliveries} />}
      {activeTab === "report" && canViewAll && <ShiftDeliveryReport deliveries={deliveries} />}
      {activeTab === "items" && canViewAll && <ExpenseItemsTab />}
    </div>
  );
}