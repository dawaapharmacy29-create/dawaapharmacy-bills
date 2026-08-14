import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const ACTIVE = ["طلب جديد", "جاري البحث", "تم الطلب", "النواقص", "تم توفير الصنف", "الصنف غير متوفر حاليا"];
const FOLLOWUP = ["جاري البحث", "تم الطلب", "النواقص", "تم توفير الصنف", "الصنف غير متوفر حاليا"];
const ARCHIVE = ["تم التوصيل", "تم الإلغاء"];
const GROUPS = { action: ["طلب جديد", "جاري البحث", "الصنف غير متوفر حاليا"], ordered: ["تم الطلب", "النواقص"], ready: ["تم توفير الصنف"], all: ACTIVE };
const initialFilters = { search: "", branch: "all", status: "all", priority: "all", source: "all", employee: "all", dateFrom: "", dateTo: "", advancedOpen: false };

export default function useCustomerOrdersWorkspace({ isManager, user }) {
  const [mainTab, setMainTab] = useState("dashboard");
  const [orderTab, setOrderTab] = useState("action");
  const [filters, setFilters] = useState(initialFilters);
  const { data: orders = [], isLoading } = useQuery({ queryKey: ["customer-orders"], queryFn: () => base44.entities.CustomerOrder.list("-created_date", 500) });
  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members"], queryFn: () => base44.entities.TeamMember.list() });
  const visibleOrders = useMemo(() => orders.filter((o) => isManager || !user?.branch || o.branch === user.branch), [orders, isManager, user?.branch]);
  const filteredOrders = useMemo(() => {
    let rows = visibleOrders;
    if (mainTab === "archive") rows = rows.filter((o) => ARCHIVE.includes(o.status));
    if (mainTab === "followup") rows = rows.filter((o) => FOLLOWUP.includes(o.status));
    if (mainTab === "orders") rows = rows.filter((o) => (GROUPS[orderTab] || ACTIVE).includes(o.status));
    const f = filters;
    return rows.filter((o) => {
      if (f.branch !== "all" && o.branch !== f.branch) return false;
      if (f.status !== "all" && o.status !== f.status) return false;
      if (f.priority !== "all" && o.priority !== f.priority) return false;
      if (f.source !== "all" && o.request_source !== f.source) return false;
      if (f.employee !== "all" && o.assigned_employee !== f.employee) return false;
      const date = String(o.request_date || o.created_date || "").slice(0, 10);
      if (f.dateFrom && date < f.dateFrom) return false;
      if (f.dateTo && date > f.dateTo) return false;
      if (f.search) {
        const q = f.search.trim().toLowerCase();
        const text = [o.customer_name, o.phone, o.product_name, o.order_number, o.customer_code, o.assigned_employee].filter(Boolean).join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [visibleOrders, mainTab, orderTab, filters]);
  return { mainTab, setMainTab, orderTab, setOrderTab, filters, setFilters, orders: visibleOrders, filteredOrders, teamMembers, isLoading };
}
