import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Settings } from "lucide-react";
import DailyProgressIndicator from "@/components/dashboard/DailyProgressIndicator";
import { useUserRole } from "@/lib/useUserRole";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getInvoiceNetAmount } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const branchColor = {
  "دواء شكري": { bar: "bg-blue-500", light: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
  "دواء الشامي": { bar: "bg-purple-500", light: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
};

export default function BranchBudgetCard({ invoices, budgets, suppliers = [], startDate, endDate }) {
  const { canSetBudget } = useUserRole();
  const [editOpen, setEditOpen] = useState(false);
  const [limits, setLimits] = useState({});
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      for (const branch of BRANCHES) {
        const existing = budgets.find((b) => b.branch === branch);
        const val = parseFloat(data[branch]) || 0;
        if (existing) {
          await base44.entities.BranchBudget.update(existing.id, { budget_limit: val });
        } else {
          await base44.entities.BranchBudget.create({ branch, budget_limit: val });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
      setEditOpen(false);
    },
  });

  const openEdit = () => {
    const init = {};
    BRANCHES.forEach((b) => {
      const found = budgets.find((x) => x.branch === b);
      init[b] = found ? found.budget_limit : "";
    });
    setLimits(init);
    setEditOpen(true);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-700">📊 الحد الأقصى للمشتريات لكل فرع</h2>
        {canSetBudget && (
          <Button size="sm" variant="outline" onClick={openEdit} className="gap-1 text-xs">
            <Settings className="w-3.5 h-3.5" /> تعديل الحدود
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {BRANCHES.map((branch) => {
          const c = branchColor[branch];
          const budget = budgets.find((b) => b.branch === branch);
          const limit = budget?.budget_limit || 0;
          const spent = invoices.filter((i) => i.branch === branch).reduce((s, i) => s + getInvoiceNetAmount(i, suppliers), 0);
          const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
          const remaining = limit - spent;
          const isOver = spent > limit && limit > 0;
          const isNear = pct >= 80 && !isOver;

          return (
            <Card key={branch} className={`p-4 border-2 ${c.light} ${c.border}`}>
              <div className={`font-bold text-sm ${c.text} mb-2`}>{branch}</div>

              {limit === 0 ? (
                <p className="text-xs text-gray-400">لم يتم تحديد حد أقصى بعد</p>
              ) : (
                <>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>المُنفق: <b>{spent.toLocaleString("ar-EG")} ج</b></span>
                    <span>الحد: <b>{limit.toLocaleString("ar-EG")} ج</b></span>
                  </div>

                  <DailyProgressIndicator startDate={startDate} endDate={endDate} currentAmount={spent} targetAmount={limit} height="h-2.5" color={c.bar} />
                </>
              )}
            </Card>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">تعديل الحد الأقصى للفروع</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {BRANCHES.map((branch) => (
              <div key={branch} className="space-y-1">
                <label className="text-sm font-medium text-gray-700">{branch}</label>
                <Input
                  type="number"
                  min="0"
                  value={limits[branch] || ""}
                  onChange={(e) => setLimits((p) => ({ ...p, [branch]: e.target.value }))}
                  placeholder="أدخل الحد الأقصى بالجنيه"
                />
              </div>
            ))}
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(limits)}
            >
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}