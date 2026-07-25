import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MedicineDashboard from "@/components/medicine/MedicineDashboard";
import MedicineSalesTab from "@/components/medicine/MedicineSalesTab";
import MedicineItemsAdmin from "@/components/medicine/MedicineItemsAdmin";
import { useUserRole } from "@/lib/useUserRole";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

function BranchBalanceTable() {
  const { data: items = [] } = useQuery({
    queryKey: ["medicine-items"],
    queryFn: () => base44.entities.MedicineItem.list("name"),
    staleTime: 60000,
  });
  const { data: allRecords = [] } = useQuery({
    queryKey: ["medicine-all-records"],
    queryFn: () => base44.entities.MedicineSale.list("-created_date", 1000),
    staleTime: 15000,
  });

  const activeItems = items.filter((i) => i.is_active !== false);
  const balanceRecords = allRecords.filter((r) => r.record_type === "balance");
  const sorted = [...balanceRecords].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  if (activeItems.length === 0 || balanceRecords.length === 0) return null;

  // لكل فرع: قائمة أصنافه وأرصدتها من أحدث سجل
  const branchItemBalances = {};
  BRANCHES.forEach((branch) => {
    branchItemBalances[branch] = {};
    activeItems.forEach((item) => {
      const record = sorted.find(
        (r) => r.branch === branch && (r.sales || []).some((x) => x.medicine_id === item.id || x.medicine_name === item.name)
      );
      if (record) {
        const entry = (record.sales || []).find((x) => x.medicine_id === item.id || x.medicine_name === item.name);
        const val = entry?.balance;
        branchItemBalances[branch][item.id] = (val !== undefined && val !== null) ? Number(val) : null;
      } else {
        branchItemBalances[branch][item.id] = null;
      }
    });
  });

  return (
    <div className="mt-8">
      <h2 className="text-base font-semibold text-gray-700 mb-4">رصيد كل فرع من كل صنف</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {BRANCHES.map((branch, bi) => {
          const colors = [
            { header: "bg-blue-700", row: "bg-blue-50", val: "text-blue-700", border: "border-blue-200" },
            { header: "bg-purple-700", row: "bg-purple-50", val: "text-purple-700", border: "border-purple-200" },
          ][bi];
          const total = activeItems.reduce((s, item) => {
            const v = branchItemBalances[branch][item.id];
            return s + (v !== null && v !== undefined ? v : 0);
          }, 0);
          return (
            <div key={branch} className={`rounded-xl border ${colors.border} overflow-hidden`}>
              <div className={`${colors.header} text-white px-4 py-2.5 flex justify-between items-center`}>
                <span className="font-bold text-sm">{branch}</span>
                <span className="text-xs opacity-80">الإجمالي: {total.toLocaleString("ar-EG")}</span>
              </div>
              <table className="w-full text-sm" dir="rtl">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">الصنف</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((item, idx) => {
                    const val = branchItemBalances[branch][item.id];
                    return (
                      <tr key={item.id} className={idx % 2 === 0 ? "bg-white" : colors.row}>
                        <td className="px-3 py-2 font-medium text-gray-700">{item.name}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`font-bold ${val !== null && val !== undefined ? colors.val : "text-gray-300"}`}>
                            {val !== null && val !== undefined ? val.toLocaleString("ar-EG") : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MedicineList() {
  const { isAdmin, isManager } = useUserRole();

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">أدوية اللسته</h1>
        <p className="text-gray-500 text-sm mt-0.5">متابعة مبيعات الأصناف الأسبوعية</p>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="mb-4">
          <TabsTrigger value="dashboard">أصناف اللسته</TabsTrigger>
          <TabsTrigger value="sales">تسجيل المبيعات</TabsTrigger>
          {(isAdmin || isManager) && <TabsTrigger value="admin">إدارة الأصناف</TabsTrigger>}
        </TabsList>

        <TabsContent value="dashboard">
          <MedicineDashboard />
          <BranchBalanceTable />
        </TabsContent>
        <TabsContent value="sales">
          <MedicineSalesTab />
        </TabsContent>
        {(isAdmin || isManager) && (
          <TabsContent value="admin">
            <MedicineItemsAdmin />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}