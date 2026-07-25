import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Search, Save, Flag, Info } from "lucide-react";

const TODAY = new Date().toISOString().split("T")[0];

const getDiffClass = (diff) => {
  if (diff === null || diff === undefined) return "bg-white border-gray-200";
  if (diff === 0) return "bg-green-50 border-green-200";
  if (diff < 0) return "bg-red-50 border-red-200";
  return "bg-blue-50 border-blue-200";
};

const getDiffBadge = (diff) => {
  if (diff === null || diff === undefined) return null;
  if (diff === 0) return <Badge className="bg-green-100 text-green-800">مطابق ✓</Badge>;
  if (diff < 0) return <Badge className="bg-red-100 text-red-800">عجز {Math.abs(diff)}</Badge>;
  return <Badge className="bg-blue-100 text-blue-800">زيادة +{diff}</Badge>;
};

export default function DailyCountScreen({ task }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [localEntries, setLocalEntries] = useState({});
  const [saving, setSaving] = useState({});

  const { data: allEntries = [] } = useQuery({
    queryKey: ["inventory-entries", task?.id],
    queryFn: () => base44.entities.InventoryCountEntry.filter({ task_id: task.id }),
    enabled: !!task?.id,
    staleTime: 10000,
  });

  useEffect(() => {
    const map = {};
    allEntries.forEach(e => { map[e.id] = e; });
    setLocalEntries(map);
  }, [allEntries]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.InventoryCountEntry.update(id, data),
    onSuccess: () => qc.invalidateQueries(["inventory-entries", task?.id]),
  });

  const filteredEntries = Object.values(localEntries)
    .filter(e => !search || e.product_name?.includes(search) || e.product_code?.includes(search))
    .sort((a, b) => {
      if (a.status === "لم يُجرد" && b.status !== "لم يُجرد") return -1;
      if (a.status !== "لم يُجرد" && b.status === "لم يُجرد") return 1;
      return 0;
    });

  const done = Object.values(localEntries).filter(e => e.status === "مكتمل");
  const pending = Object.values(localEntries).filter(e => e.status === "لم يُجرد");
  const total = Object.values(localEntries).length;
  const isCompleted = task?.status === "مكتمل";

  const handleActualChange = (id, value) => {
    setLocalEntries(prev => {
      const entry = prev[id];
      const actual = value === "" ? null : Number(value);
      const diff = actual !== null ? actual - (entry.expected_quantity || 0) : null;
      return { ...prev, [id]: { ...entry, actual_quantity: actual, difference: diff } };
    });
  };

  const handleSalesAdjustedChange = (id, checked) => {
    setLocalEntries(prev => ({
      ...prev,
      [id]: { ...prev[id], sales_adjusted: checked }
    }));
  };

  const handleSaveEntry = async (id) => {
    const entry = localEntries[id];
    if (entry.actual_quantity === null || entry.actual_quantity === undefined) return;
    setSaving(p => ({ ...p, [id]: true }));
    const diff = entry.actual_quantity - (entry.expected_quantity || 0);
    // If sales_adjusted: treat as no real discrepancy for stats
    const effectiveDiff = entry.sales_adjusted ? 0 : diff;
    await updateMutation.mutateAsync({
      id,
      data: { actual_quantity: entry.actual_quantity, difference: effectiveDiff, status: "مكتمل", sales_adjusted: entry.sales_adjusted || false }
    });
    if (entry.product_id) {
      await base44.entities.InventoryProduct.update(entry.product_id, {
        last_counted_date: TODAY,
        stock_quantity: entry.actual_quantity,
        discrepancy_count: diff !== 0
          ? ((await base44.entities.InventoryProduct.filter({ id: entry.product_id }))[0]?.discrepancy_count || 0) + 1
          : undefined,
      });
    }
    setSaving(p => ({ ...p, [id]: false }));
  };

  const handleFinishSession = async () => {
    const entries = Object.values(localEntries);
    const completedEntries = entries.filter(e => e.status === "مكتمل");
    const matched = completedEntries.filter(e => e.difference === 0).length;
    const diffs = completedEntries.filter(e => e.difference !== 0).length;
    const acc = completedEntries.length > 0
      ? Math.round((matched / completedEntries.length) * 100) : 0;

    await base44.entities.InventoryCountTask.update(task.id, {
      status: "مكتمل",
      completed_count: completedEntries.length,
      matched_count: matched,
      diff_count: diffs,
      accuracy_rate: acc,
      finished_at: new Date().toISOString(),
    });
    qc.invalidateQueries(["inventory-tasks"]);
    qc.invalidateQueries(["inventory-entries", task.id]);
  };

  return (
    <div dir="rtl" className="space-y-4">
      {/* Progress bar */}
      <div className="bg-white border rounded-xl p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium text-gray-700">التقدم</span>
          <span className="text-gray-500">{done.length} / {total}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-teal-500 h-2.5 rounded-full transition-all duration-300"
            style={{ width: total > 0 ? `${(done.length / total) * 100}%` : "0%" }}
          />
        </div>
        <div className="flex gap-3 text-xs text-gray-500">
          <span className="text-green-600">✓ {done.length} مكتمل</span>
          <span className="text-yellow-600">○ {pending.length} لم يُجرد</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-2 top-2.5 w-4 h-4 text-gray-400" />
        <Input
          className="pr-7"
          placeholder="بحث باسم أو كود الصنف..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Entries */}
      <div className="space-y-2">
        {filteredEntries.map(entry => (
          <div
            key={entry.id}
            className={`border rounded-xl p-3 transition-colors ${getDiffClass(entry.status === "مكتمل" ? entry.difference : null)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-800 text-sm">{entry.product_name}</p>
                {entry.product_code && (
                  <p className="text-xs text-gray-400">كود: {entry.product_code}</p>
                )}
              </div>
              {entry.status === "مكتمل"
                ? getDiffBadge(entry.difference)
                : <Badge className="bg-gray-100 text-gray-600"><Clock className="w-3 h-3 ml-1" />لم يُجرد</Badge>
              }
            </div>

            <div className="flex items-center gap-4 mt-2 flex-wrap">
              <div className="text-center">
                <p className="text-xs text-gray-500">كمية النظام</p>
                <p className="text-xl font-bold text-gray-700">{entry.expected_quantity}</p>
              </div>
              <div className="text-gray-300 text-lg">←</div>
              <div>
                <p className="text-xs text-gray-500 mb-1">الكمية الفعلية</p>
                <Input
                  type="number"
                  min={0}
                  className="w-28 h-10 text-center text-xl font-bold"
                  value={entry.actual_quantity ?? ""}
                  onChange={e => handleActualChange(entry.id, e.target.value)}
                  disabled={entry.status === "مكتمل" || isCompleted}
                />
              </div>
              {entry.actual_quantity !== null && entry.actual_quantity !== undefined && entry.actual_quantity !== "" && entry.status !== "مكتمل" && (
                <div className="text-center">
                  <p className="text-xs text-gray-500">الفارق</p>
                  <p className={`text-xl font-bold ${entry.difference < 0 ? "text-red-600" : entry.difference > 0 ? "text-blue-600" : "text-green-600"}`}>
                    {entry.difference > 0 ? "+" : ""}{entry.difference}
                  </p>
                </div>
              )}
            </div>

            {entry.status !== "مكتمل" && !isCompleted && entry.actual_quantity !== null && entry.actual_quantity !== undefined && entry.actual_quantity !== "" && entry.difference !== 0 && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <input
                  type="checkbox"
                  checked={!!entry.sales_adjusted}
                  onChange={e => handleSalesAdjustedChange(entry.id, e.target.checked)}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-xs text-orange-700 font-medium">الفارق ناتج عن حركة البيع — يُعد مطابقاً</span>
                <Info className="w-3.5 h-3.5 text-orange-400 mr-auto" />
              </label>
            )}

            {entry.status !== "مكتمل" && !isCompleted && (
              <Button
                size="sm"
                className="mt-2 w-full gap-1 bg-teal-600 hover:bg-teal-700 text-xs h-8"
                onClick={() => handleSaveEntry(entry.id)}
                disabled={saving[entry.id] || entry.actual_quantity === null || entry.actual_quantity === undefined || entry.actual_quantity === ""}
              >
                <Save className="w-3 h-3" />
                {saving[entry.id] ? "جاري الحفظ..." : "حفظ"}
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Finish button */}
      {!isCompleted && done.length > 0 && (
        <Button
          className="w-full gap-2 bg-green-600 hover:bg-green-700 h-12 text-base"
          onClick={handleFinishSession}
        >
          <Flag className="w-5 h-5" />
          إنهاء الجرد ({done.length}/{total} مكتمل)
        </Button>
      )}

      {isCompleted && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="font-bold text-green-700">تم إنهاء هذه الجلسة</p>
          <p className="text-sm text-gray-500">لا يمكن تعديل الجلسة بعد الإنهاء</p>
        </div>
      )}
    </div>
  );
}