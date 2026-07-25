import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Award, CalendarRange, Pencil } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";

const TODAY = new Date().toISOString().split("T")[0];

function formatDateAr(d) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" });
}

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const branchColor = {
  "دواء شكري": "bg-blue-50 border-blue-200 text-blue-700",
  "دواء الشامي": "bg-purple-50 border-purple-200 text-purple-700",
};

export default function MedicineDashboard() {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useUserRole();
  const canSetRange = isAdmin || isManager;
  const [rangeDialogOpen, setRangeDialogOpen] = useState(false);
  const [rangeForm, setRangeForm] = useState({ from: "", to: "" });

  const { data: settings = [] } = useQuery({
    queryKey: ["report-settings"],
    queryFn: () => base44.entities.ReportSettings.list(),
    staleTime: 30000,
  });

  const displayFrom = settings.find((s) => s.key === "medicine_display_from")?.value || "";
  const displayTo = settings.find((s) => s.key === "medicine_display_to")?.value || "";
  const fromSettingId = settings.find((s) => s.key === "medicine_display_from")?.id;
  const toSettingId = settings.find((s) => s.key === "medicine_display_to")?.id;

  const saveRangeMutation = useMutation({
    mutationFn: async ({ from, to }) => {
      if (fromSettingId) {
        await base44.entities.ReportSettings.update(fromSettingId, { key: "medicine_display_from", value: from });
      } else {
        await base44.entities.ReportSettings.create({ key: "medicine_display_from", value: from });
      }
      if (toSettingId) {
        await base44.entities.ReportSettings.update(toSettingId, { key: "medicine_display_to", value: to });
      } else {
        await base44.entities.ReportSettings.create({ key: "medicine_display_to", value: to });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-settings"] });
      setRangeDialogOpen(false);
    },
  });

  const openRangeDialog = () => {
    setRangeForm({ from: displayFrom || TODAY, to: displayTo || TODAY });
    setRangeDialogOpen(true);
  };

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

  const salesRecords = allRecords.filter((r) => !r.record_type || r.record_type === "sales");
  const balanceRecords = allRecords.filter((r) => r.record_type === "balance");

  const activeItems = items.filter((i) => i.is_active !== false);

  // أحدث رصيد فعلي لكل صنف في كل فرع
  const sortedBalanceRecords = [...balanceRecords].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  // لكل صنف: أحدث قيمة رصيد في كل فرع
  const latestBalanceByItem = {};
  activeItems.forEach((item) => {
    latestBalanceByItem[item.id] = {};
    BRANCHES.forEach((branch) => {
      const record = sortedBalanceRecords.find(
        (r) => r.branch === branch && (r.sales || []).some((x) => x.medicine_id === item.id || x.medicine_name === item.name)
      );
      if (record) {
        const entry = (record.sales || []).find((x) => x.medicine_id === item.id || x.medicine_name === item.name);
        const val = entry?.balance;
        latestBalanceByItem[item.id][branch] = (val !== undefined && val !== null) ? Number(val) : null;
      } else {
        latestBalanceByItem[item.id][branch] = null;
      }
    });
  });

  // إجمالي مبيعات كل صنف
  const itemTotals = activeItems.map((item) => {
    let total = 0;
    let byBranch = {};
    salesRecords.forEach((s) => {
      (s.sales || []).forEach((sale) => {
        if (sale.medicine_name === item.name || sale.medicine_id === item.id) {
          total += sale.quantity || 0;
          byBranch[s.branch] = (byBranch[s.branch] || 0) + (sale.quantity || 0);
        }
      });
    });
    const topBranch = Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { item, total, byBranch, topBranch };
  });

  // إجمالي مبيعات كل فرع
  const branchTotals = BRANCHES.map((b) => ({
    branch: b,
    total: salesRecords.reduce((sum, s) => {
      if (s.branch !== b) return sum;
      return sum + (s.sales || []).reduce((ss, sale) => ss + (sale.quantity || 0), 0);
    }, 0),
  }));
  const topBranch = [...branchTotals].sort((a, b) => b.total - a.total)[0]?.branch;

  return (
    <div className="space-y-6">
      {/* Display range bar */}
      <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg px-4 py-2 gap-3">
        <div className="flex items-center gap-2 text-sm text-teal-800">
          <CalendarRange className="w-4 h-4" />
          {displayFrom && displayTo ? (
            <span>عرض الفترة: <strong>{formatDateAr(displayFrom)}</strong> — <strong>{formatDateAr(displayTo)}</strong></span>
          ) : (
            <span className="text-teal-600">لم يتم تحديد فترة عرض بعد</span>
          )}
        </div>
        {canSetRange && (
          <Button size="sm" variant="outline" onClick={openRangeDialog} className="text-teal-700 border-teal-300 hover:bg-teal-100 gap-1 h-7 text-xs">
            <Pencil className="w-3 h-3" /> تغيير الفترة
          </Button>
        )}
      </div>

      {/* Range dialog */}
      <Dialog open={rangeDialogOpen} onOpenChange={setRangeDialogOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>تحديد فترة العرض</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-gray-500">تحديد هذه الفترة يؤثر على ما يراه جميع المستخدمين.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>من تاريخ</Label>
                <Input type="date" value={rangeForm.from} onChange={(e) => setRangeForm((p) => ({ ...p, from: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>إلى تاريخ</Label>
                <Input type="date" value={rangeForm.to} min={rangeForm.from} onChange={(e) => setRangeForm((p) => ({ ...p, to: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-row-reverse">
            <Button className="bg-teal-600 hover:bg-teal-700" disabled={!rangeForm.from || !rangeForm.to || saveRangeMutation.isPending} onClick={() => saveRangeMutation.mutate({ from: rangeForm.from, to: rangeForm.to })}>
              {saveRangeMutation.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
            <Button variant="outline" onClick={() => setRangeDialogOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* وسام الفرع الأكثر مبيعاً */}
      {topBranch && (
        <Card className={`p-4 border-2 flex items-center gap-4 ${branchColor[topBranch]}`}>
          <Award className="w-10 h-10 text-yellow-500 shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-500">🏆 الفرع الأكثر مبيعاً</p>
            <p className="text-xl font-bold">{topBranch}</p>
            <p className="text-sm">{branchTotals.find((b) => b.branch === topBranch)?.total?.toLocaleString("ar-EG")} وحدة إجمالي</p>
          </div>
        </Card>
      )}



      {/* إجمالي مبيعات كل صنف */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">إجمالي مبيعات كل صنف</h2>
        {activeItems.length === 0 ? (
          <Card className="p-8 text-center text-gray-400">لا توجد أصناف بعد — أضفها من تبويب "إدارة الأصناف"</Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {itemTotals.map(({ item, total, byBranch, topBranch: tb }) => (
              <Card key={item.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-gray-800">{item.name}</h3>
                  <span className="text-lg font-bold text-teal-600">{total.toLocaleString("ar-EG")}</span>
                </div>
                <div className="space-y-1.5">
                  {BRANCHES.map((b) => {
                    const qty = byBranch[b] || 0;
                    const pct = total > 0 ? Math.round((qty / total) * 100) : 0;
                    return (
                      <div key={b}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className={`font-medium ${b === tb ? "text-teal-700" : "text-gray-600"}`}>
                            {b} {b === tb && "🥇"}
                          </span>
                          <span className="text-gray-500">{qty} وحدة</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full">
                          <div className="h-1.5 bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}