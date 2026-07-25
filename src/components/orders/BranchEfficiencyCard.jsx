const BRANCHES = ["دواء شكري", "دواء الشامي"];

const DONE_STATUSES = ["تم التوصيل", "تم توفير الصنف", "تم توفير بديل"];
const CANCELLED_STATUSES = ["تم الإلغاء", "الصنف غير متوفر حاليا"];

function getEfficiencyColor(rate) {
  if (rate >= 75) return { bar: "bg-green-500", text: "text-green-700", bg: "bg-green-50" };
  if (rate >= 50) return { bar: "bg-yellow-400", text: "text-yellow-700", bg: "bg-yellow-50" };
  return { bar: "bg-red-400", text: "text-red-700", bg: "bg-red-50" };
}

export default function BranchEfficiencyCard({ orders }) {
  const stats = BRANCHES.map((branch) => {
    const branchOrders = orders.filter((o) => o.branch === branch);
    const total = branchOrders.length;
    const done = branchOrders.filter((o) => o.status === "تم التوصيل").length;
    const cancelled = branchOrders.filter((o) => CANCELLED_STATUSES.includes(o.status)).length;
    const pending = total - done - cancelled;
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;
    return { branch, total, done, cancelled, pending, rate };
  });

  const maxDone = Math.max(...stats.map((s) => s.done));
  const topBranch = maxDone > 0 ? stats.find((s) => s.done === maxDone)?.branch : null;

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📊</span>
        <h3 className="font-bold text-gray-800 text-sm">كفاءة الفروع في تنفيذ الطلبات</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats.map(({ branch, total, done, cancelled, pending, rate }) => {
          const colors = getEfficiencyColor(rate);
          return (
            <div key={branch} className={`rounded-xl p-4 ${colors.bg} border`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-gray-800 text-sm">{branch}</span>
                  {topBranch === branch && (
                    <span title="الأكثر توصيلاً 🏆" className="text-lg animate-bounce">🏆</span>
                  )}
                </div>
                <span className={`text-2xl font-bold ${colors.text}`}>{rate}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3">
                <div
                  className={`h-2.5 rounded-full transition-all ${colors.bar}`}
                  style={{ width: `${rate}%` }}
                />
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="bg-white rounded-lg py-1.5 px-1">
                  <div className="text-sm font-bold text-gray-700">{total}</div>
                  <div className="text-[10px] text-gray-400">إجمالي</div>
                </div>
                <div className="bg-white rounded-lg py-1.5 px-1">
                  <div className="text-sm font-bold text-green-600">{done}</div>
                  <div className="text-[10px] text-gray-400">منفّذ</div>
                </div>
                <div className="bg-white rounded-lg py-1.5 px-1">
                  <div className="text-sm font-bold text-amber-500">{pending}</div>
                  <div className="text-[10px] text-gray-400">قيد التنفيذ</div>
                </div>
                <div className="bg-white rounded-lg py-1.5 px-1">
                  <div className="text-sm font-bold text-red-500">{cancelled}</div>
                  <div className="text-[10px] text-gray-400">ملغي/غير متوفر</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}