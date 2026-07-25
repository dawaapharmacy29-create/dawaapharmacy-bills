import { useMemo, useState } from "react";
import { Calendar, TrendingDown, TrendingUp, BarChart3, Clock, Wallet } from "lucide-react";
import ExpenseCategoryBreakdown from "./ExpenseCategoryBreakdown";
import DateRangeFilter from "./DateRangeFilter";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

export default function ShiftDeliveryStats({ deliveries }) {
  const [branch, setBranch] = useState("الكل");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    return deliveries
      .filter((d) => branch === "الكل" || d.branch === branch)
      .filter((d) => {
        if (!d.shift_date) return false;
        if (fromDate && d.shift_date < fromDate) return false;
        if (toDate && d.shift_date > toDate) return false;
        return true;
      });
  }, [deliveries, branch, fromDate, toDate]);

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStr = now.toISOString().split("T")[0];

    const monthItems = filtered.filter((d) => d.shift_date && new Date(d.shift_date) >= monthStart);
    const todayItems = filtered.filter((d) => d.shift_date === todayStr);

    const sum = (arr, key) => arr.reduce((s, d) => s + (d[key] || 0), 0);

    return {
      monthExpenses: sum(monthItems, "total_expenses"),
      todayExpenses: sum(todayItems, "total_expenses"),
      monthSales: sum(monthItems, "total_sales"),
      todaySales: sum(todayItems, "total_sales"),
      monthNet: sum(monthItems, "net_amount"),
      todayNet: sum(todayItems, "net_amount"),
      shiftCount: monthItems.length,
      shiftAvg: monthItems.length > 0 ? sum(monthItems, "net_amount") / monthItems.length : 0,
    };
  }, [filtered]);

  const cards = [
    { label: "مصروفات الشهر", value: stats.monthExpenses, icon: Calendar, color: "red" },
    { label: "مصروفات اليوم", value: stats.todayExpenses, icon: TrendingDown, color: "red" },
    { label: "مبيعات الشهر", value: stats.monthSales, icon: Calendar, color: "green" },
    { label: "مبيعات اليوم", value: stats.todaySales, icon: TrendingUp, color: "green" },
    { label: "متوسط الشيفت", value: stats.shiftAvg, icon: BarChart3, color: "yellow" },
    { label: "عدد الشفتات", value: stats.shiftCount, icon: Clock, color: "blue", isCount: true },
    { label: "صافي الشهر", value: stats.monthNet, icon: Wallet, color: "blue" },
    { label: "صافي اليوم", value: stats.todayNet, icon: Wallet, color: "blue" },
  ];

  const colorMap = {
    red: { bg: "bg-red-50", icon_bg: "bg-red-100", icon_text: "text-red-600", value_text: "text-red-700" },
    green: { bg: "bg-green-50", icon_bg: "bg-green-100", icon_text: "text-green-600", value_text: "text-green-700" },
    yellow: { bg: "bg-amber-50", icon_bg: "bg-amber-100", icon_text: "text-amber-600", value_text: "text-amber-700" },
    blue: { bg: "bg-blue-50", icon_bg: "bg-blue-100", icon_text: "text-blue-600", value_text: "text-blue-700" },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-800">لوحة الإحصائيات</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToDateChange={setToDate} />
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {["الكل", ...BRANCHES].map((b) => (
              <button
                key={b}
                onClick={() => setBranch(b)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  branch === b ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((card, idx) => {
          const c = colorMap[card.color];
          return (
            <div key={idx} className={`${c.bg} rounded-xl p-4 border border-gray-100`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-600 font-medium">{card.label}</span>
                <div className={`w-8 h-8 rounded-lg ${c.icon_bg} flex items-center justify-center`}>
                  <card.icon className={`w-4 h-4 ${c.icon_text}`} />
                </div>
              </div>
              <p className={`text-xl font-bold ${c.value_text}`}>
                {card.isCount ? card.value : fmt(card.value)}
                {!card.isCount && <span className="text-xs font-normal text-gray-400 mr-1">ج.م</span>}
              </p>
            </div>
          );
        })}
      </div>

      <ExpenseCategoryBreakdown deliveries={filtered} />
    </div>
  );
}