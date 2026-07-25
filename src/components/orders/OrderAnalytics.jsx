import { useMemo } from "react";
import { Card } from "@/components/ui/card";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const STATUSES = ["طلب جديد", "جاري البحث", "تم الطلب", "النواقص", "تم توفير الصنف", "تم التوصيل", "الصنف غير متوفر حاليا", "تم الإلغاء"];

const STATUS_COLORS = {
  "طلب جديد":              "bg-blue-100 text-blue-700",
  "جاري البحث":            "bg-yellow-100 text-yellow-700",
  "تم الطلب":              "bg-indigo-100 text-indigo-700",
  "النواقص":               "bg-purple-100 text-purple-700",
  "تم توفير الصنف":        "bg-teal-100 text-teal-700",
  "تم التوصيل":            "bg-green-100 text-green-700",
  "الصنف غير متوفر حاليا": "bg-orange-100 text-orange-700",
  "تم الإلغاء":            "bg-red-100 text-red-700",
};

export default function OrderAnalytics({ orders }) {
  // جدول: لكل فرع عدد الطلبات حسب كل حالة
  const branchStatusTable = useMemo(() => {
    const table = {};
    BRANCHES.forEach((b) => {
      table[b] = {};
      STATUSES.forEach((s) => { table[b][s] = 0; });
      table[b]["__total"] = 0;
    });
    orders.forEach((o) => {
      const branch = o.branch || "غير محدد";
      const status = o.status || "طلب جديد";
      if (!table[branch]) {
        table[branch] = {};
        STATUSES.forEach((s) => { table[branch][s] = 0; });
        table[branch]["__total"] = 0;
      }
      if (table[branch][status] !== undefined) table[branch][status]++;
      table[branch]["__total"]++;
    });
    return table;
  }, [orders]);

  // إجماليات لكل حالة
  const statusTotals = useMemo(() => {
    const map = {};
    STATUSES.forEach((s) => { map[s] = 0; });
    orders.forEach((o) => {
      const status = o.status || "طلب جديد";
      if (map[status] !== undefined) map[status]++;
    });
    return map;
  }, [orders]);

  const grandTotal = orders.length;

  // الأصناف الأكثر طلباً
  const productStats = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const name = o.product_name || "غير محدد";
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  }, [orders]);

  // العملاء الأكثر طلباً
  const customerStats = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const name = o.customer_name || "غير محدد";
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  }, [orders]);

  if (orders.length === 0) {
    return <div className="text-center py-16 text-gray-400">لا توجد بيانات للعرض</div>;
  }

  return (
    <div className="space-y-6">

      {/* جدول الفروع × الحالات */}
      <Card className="p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-4">إحصائيات الطلبات لكل فرع حسب الحالة</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" dir="rtl">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600">الفرع</th>
                {STATUSES.map((s) => (
                  <th key={s} className="px-2 py-2.5 text-center font-semibold text-gray-600 whitespace-nowrap">{s}</th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold text-gray-600">الإجمالي</th>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-600">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {BRANCHES.map((branch, idx) => {
                const branchTotal = branchStatusTable[branch]?.["__total"] || 0;
                const pct = grandTotal > 0 ? ((branchTotal / grandTotal) * 100).toFixed(1) : 0;
                return (
                  <tr key={branch} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-3 py-2.5 font-bold text-gray-800 whitespace-nowrap">{branch}</td>
                    {STATUSES.map((s) => {
                      const count = branchStatusTable[branch]?.[s] || 0;
                      return (
                        <td key={s} className="px-2 py-2.5 text-center">
                          {count > 0 ? (
                            <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[s]}`}>{count}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center font-bold text-gray-800">{branchTotal}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="bg-teal-50 text-teal-700 font-bold px-2 py-0.5 rounded-full">{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 font-bold">
                <td className="px-3 py-2.5 text-gray-700">الإجمالي</td>
                {STATUSES.map((s) => (
                  <td key={s} className="px-2 py-2.5 text-center text-gray-800">
                    {statusTotals[s] > 0 ? statusTotals[s] : "—"}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center text-teal-700">{grandTotal}</td>
                <td className="px-3 py-2.5 text-center text-teal-700">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* إنفوجرام كفاءة الفروع */}
      <Card className="p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-1">كفاءة الفروع — نسبة تنفيذ الطلبات</h3>
        <p className="text-xs text-gray-400 mb-5">بناءً على حالة "تم التوصيل" + "تم توفير الصنف" من إجمالي طلبات كل فرع</p>
        <div className="space-y-6">
          {BRANCHES.map((branch) => {
            const total = branchStatusTable[branch]?.["__total"] || 0;
            const delivered = branchStatusTable[branch]?.["تم التوصيل"] || 0;
            const provided = branchStatusTable[branch]?.["تم توفير الصنف"] || 0;
            const cancelled = branchStatusTable[branch]?.["تم الإلغاء"] || 0;
            const unavailable = branchStatusTable[branch]?.["الصنف غير متوفر حاليا"] || 0;
            const inProgress = branchStatusTable[branch]?.["جاري البحث"] || 0 + branchStatusTable[branch]?.["تم الطلب"] || 0;
            const completed = delivered + provided;
            const efficiency = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
            const cancelRate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
            const color = efficiency >= 70 ? "text-green-600" : efficiency >= 40 ? "text-yellow-600" : "text-red-600";
            const barColor = efficiency >= 70 ? "bg-green-500" : efficiency >= 40 ? "bg-yellow-500" : "bg-red-500";
            return (
              <div key={branch}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-800 text-sm">{branch}</span>
                  <span className={`text-2xl font-black ${color}`}>{efficiency}%</span>
                </div>
                {/* شريط التقدم التفصيلي */}
                <div className="h-6 rounded-full overflow-hidden flex bg-gray-100 mb-3">
                  {total > 0 && (
                    <>
                      <div className="bg-green-500 h-full transition-all flex items-center justify-center" style={{ width: `${(delivered / total) * 100}%` }} title="تم التوصيل">
                        {delivered > 0 && <span className="text-white text-[10px] font-bold px-1 truncate">{delivered}</span>}
                      </div>
                      <div className="bg-teal-400 h-full transition-all flex items-center justify-center" style={{ width: `${(provided / total) * 100}%` }} title="تم توفير الصنف">
                        {provided > 0 && <span className="text-white text-[10px] font-bold px-1 truncate">{provided}</span>}
                      </div>
                      <div className="bg-yellow-400 h-full transition-all" style={{ width: `${(inProgress / total) * 100}%` }} title="جاري" />
                      <div className="bg-orange-400 h-full transition-all" style={{ width: `${(unavailable / total) * 100}%` }} title="غير متوفر" />
                      <div className="bg-red-400 h-full transition-all flex items-center justify-center" style={{ width: `${(cancelled / total) * 100}%` }} title="تم الإلغاء">
                        {cancelled > 0 && <span className="text-white text-[10px] font-bold px-1 truncate">{cancelled}</span>}
                      </div>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-green-50 rounded-lg py-2 px-1">
                    <p className="text-lg font-black text-green-600">{completed}</p>
                    <p className="text-[10px] text-gray-500">تم التنفيذ</p>
                  </div>
                  <div className="bg-red-50 rounded-lg py-2 px-1">
                    <p className="text-lg font-black text-red-500">{cancelled}</p>
                    <p className="text-[10px] text-gray-500">ملغي ({cancelRate}%)</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg py-2 px-1">
                    <p className="text-lg font-black text-orange-500">{unavailable}</p>
                    <p className="text-[10px] text-gray-500">غير متوفر</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg py-2 px-1">
                    <p className="text-lg font-black text-gray-600">{total}</p>
                    <p className="text-[10px] text-gray-500">إجمالي</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* مفتاح الألوان */}
        <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t">
          {[
            { color: "bg-green-500", label: "تم التوصيل" },
            { color: "bg-teal-400", label: "تم توفير الصنف" },
            { color: "bg-yellow-400", label: "جاري" },
            { color: "bg-orange-400", label: "غير متوفر" },
            { color: "bg-red-400", label: "ملغي" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-full ${color}`} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* الأصناف الأكثر طلباً */}
        <Card className="p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-4">الأصناف الأكثر طلبًا</h3>
          {productStats.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">لا توجد بيانات</p> : (
            <div className="space-y-2">
              {productStats.map((p, i) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="w-5 text-xs text-gray-400 font-mono">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm text-gray-700 truncate">{p.name}</span>
                      <span className="text-sm font-bold text-teal-700">{p.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full">
                      <div className="h-1.5 bg-teal-500 rounded-full" style={{ width: `${(p.count / productStats[0].count) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* العملاء الأكثر طلباً */}
        <Card className="p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-4">العملاء الأكثر طلبًا</h3>
          {customerStats.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">لا توجد بيانات</p> : (
            <div className="space-y-2">
              {customerStats.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <span className="text-sm text-gray-700">{c.name}</span>
                  </div>
                  <span className="text-sm font-bold text-gray-800">{c.count} طلب</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}