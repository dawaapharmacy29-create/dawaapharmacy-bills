import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line
} from "recharts";
import ExportButtons from "@/components/reports/ExportButtons";
import AgingReport from "@/components/reports/AgingReport";
import TopSuppliers from "@/components/reports/TopSuppliers";
import MonthlyBranchReport from "@/components/reports/MonthlyBranchReport";
import { useUserRole } from "@/lib/useUserRole";
import { Lock, Settings2, Save } from "lucide-react";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const BRANCH_COLORS = { "دواء شكري": "#3b82f6", "دواء الشامي": "#a855f7" };
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const SETTING_KEY_FROM = "report_date_from";
const SETTING_KEY_TO = "report_date_to";

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(to + "T23:59:59")) return false;
  return true;
}

const thisYear = new Date().getFullYear();
const DEFAULT_FROM = `${thisYear}-01-01`;
const DEFAULT_TO = `${thisYear}-12-31`;

export default function Reports() {
  const { isManager } = useUserRole();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [pendingFrom, setPendingFrom] = useState(DEFAULT_FROM);
  const [pendingTo, setPendingTo] = useState(DEFAULT_TO);

  const { data: invoices = [] } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: async () => {
      const PAGE = 500; let all = []; let page = 0;
      while (true) {
        const batch = await base44.entities.PurchaseInvoice.list("-created_date", PAGE, page * PAGE);
        all = [...all, ...batch];
        if (batch.length < PAGE) break;
        page++;
      }
      return all;
    },
    staleTime: 60000,
  });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => base44.entities.Expense.list("-created_date", 5000) });
  const { data: settings = [] } = useQuery({ queryKey: ["report-settings"], queryFn: () => base44.entities.ReportSettings.list() });

  const settingFrom = settings.find(s => s.key === SETTING_KEY_FROM);
  const settingTo = settings.find(s => s.key === SETTING_KEY_TO);
  const activeFrom = settingFrom?.value || DEFAULT_FROM;
  const activeTo = settingTo?.value || DEFAULT_TO;

  // Sync pending when settings load
  useEffect(() => {
    if (settingFrom) setPendingFrom(settingFrom.value);
    if (settingTo) setPendingTo(settingTo.value);
  }, [settingFrom?.value, settingTo?.value]);

  const saveSettings = async () => {
    setSaving(true);
    if (settingFrom) {
      await base44.entities.ReportSettings.update(settingFrom.id, { value: pendingFrom });
    } else {
      await base44.entities.ReportSettings.create({ key: SETTING_KEY_FROM, value: pendingFrom });
    }
    if (settingTo) {
      await base44.entities.ReportSettings.update(settingTo.id, { value: pendingTo });
    } else {
      await base44.entities.ReportSettings.create({ key: SETTING_KEY_TO, value: pendingTo });
    }
    queryClient.invalidateQueries({ queryKey: ["report-settings"] });
    setSaving(false);
  };

  const filteredInvoices = useMemo(() => invoices.filter(i => inRange(i.created_date, activeFrom, activeTo)), [invoices, activeFrom, activeTo]);
  const filteredExpenses = useMemo(() => expenses.filter(e => inRange(e.date, activeFrom, activeTo)), [expenses, activeFrom, activeTo]);

  // Monthly data
  const monthlyData = useMemo(() => {
    const map = {};
    filteredInvoices.forEach((i) => {
      const k = getMonthKey(i.created_date);
      if (!k) return;
      if (!map[k]) { const [y, m] = k.split("-"); map[k] = { month: `${MONTHS_AR[parseInt(m)-1]} ${y}`, invoices: 0, expenses: 0 }; }
      map[k].invoices += i.total_value || 0;
    });
    filteredExpenses.forEach((e) => {
      const k = getMonthKey(e.date);
      if (!k) return;
      if (!map[k]) { const [y, m] = k.split("-"); map[k] = { month: `${MONTHS_AR[parseInt(m)-1]} ${y}`, invoices: 0, expenses: 0 }; }
      map[k].expenses += e.amount || 0;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [filteredInvoices, filteredExpenses]);

  // Branch comparison
  const branchData = useMemo(() => {
    return BRANCHES.map((branch) => ({
      branch: branch,
      مشتريات: filteredInvoices.filter(i => i.branch === branch).reduce((s, i) => s + (i.total_value || 0), 0),
      مصروفات: filteredExpenses.filter(e => e.branch === branch).reduce((s, e) => s + (e.amount || 0), 0),
    }));
  }, [filteredInvoices, filteredExpenses]);

  // Monthly per branch
  const branchMonthlyData = useMemo(() => {
    const map = {};
    filteredInvoices.forEach((i) => {
      const k = getMonthKey(i.created_date);
      const bKey = i.branch;
      if (!k || !bKey) return;
      if (!map[k]) { const [y, m] = k.split("-"); map[k] = { month: `${MONTHS_AR[parseInt(m)-1]} ${y}` }; BRANCHES.forEach(b => { map[k][b] = 0; }); }
      map[k][bKey] = (map[k][bKey] || 0) + (i.total_value || 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [filteredInvoices]);

  const totalInvoices = filteredInvoices.reduce((s, i) => s + (i.total_value || 0), 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const fmt = (n) => n.toLocaleString("ar-EG");

  const changed = pendingFrom !== activeFrom || pendingTo !== activeTo;

  const formatDateAr = (d) => d ? new Date(d).toLocaleDateString("ar-EG") : "";

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">التقارير — إجمالي الفرعين</h1>
          <p className="text-gray-500 text-sm mt-0.5">مقارنة الفروع والنفقات للفترة المحددة</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isManager ? (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex-wrap">
              <Settings2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-xs text-blue-600 font-medium">فترة التقارير:</span>
              <div className="flex items-center gap-1">
                <label className="text-xs text-blue-500">من</label>
                <input type="date" value={pendingFrom} onChange={e => setPendingFrom(e.target.value)}
                  className="border border-blue-200 rounded px-2 py-1 text-sm text-blue-700 bg-white focus:outline-none" />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-blue-500">إلى</label>
                <input type="date" value={pendingTo} onChange={e => setPendingTo(e.target.value)}
                  className="border border-blue-200 rounded px-2 py-1 text-sm text-blue-700 bg-white focus:outline-none" />
              </div>
              {changed && (
                <Button size="sm" onClick={saveSettings} disabled={saving} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1">
                  <Save className="w-3 h-3" />
                  {saving ? "جاري الحفظ..." : "حفظ"}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Lock className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                من <strong>{formatDateAr(activeFrom)}</strong> إلى <strong>{formatDateAr(activeTo)}</strong>
              </span>
            </div>
          )}
          <ExportButtons
            invoices={filteredInvoices}
            expenses={filteredExpenses}
            year={new Date(activeFrom).getFullYear()}
            branchData={branchData}
            monthlyData={monthlyData}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "إجمالي المشتريات", value: fmt(totalInvoices) + " ج", color: "text-blue-600", bg: "bg-blue-50" },
          { label: "إجمالي المصروفات", value: fmt(totalExpenses) + " ج", color: "text-red-600", bg: "bg-red-50" },
          { label: "عدد الفواتير", value: filteredInvoices.length, color: "text-teal-600", bg: "bg-teal-50" },
          { label: "عدد المصروفات", value: filteredExpenses.length, color: "text-orange-600", bg: "bg-orange-50" },
        ].map((s) => (
          <Card key={s.label} className={`p-4 ${s.bg}`}>
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Branch Comparison */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">مقارنة المشتريات والمصروفات بين الفروع</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={branchData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="branch" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
            <Tooltip formatter={(v) => v.toLocaleString("ar-EG") + " ج"} />
            <Legend />
            <Bar dataKey="مشتريات" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="مصروفات" fill="#f97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Monthly Trend */}
      {monthlyData.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">تطور المشتريات والمصروفات شهرياً</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
              <Tooltip formatter={(v) => v.toLocaleString("ar-EG") + " ج"} />
              <Legend />
              <Line type="monotone" dataKey="invoices" name="مشتريات" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="مصروفات" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Monthly Branch Report */}
      <MonthlyBranchReport invoices={invoices} expenses={expenses} />

      {/* Aging Report */}
      <AgingReport invoices={invoices} />

      {/* All Suppliers Table */}
      <TopSuppliers invoices={invoices} dateFrom={activeFrom} dateTo={activeTo} />

      {/* Monthly per Branch */}
      {branchMonthlyData.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">المشتريات الشهرية لكل فرع</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={branchMonthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
              <Tooltip formatter={(v) => v.toLocaleString("ar-EG") + " ج"} />
              <Legend />
              {BRANCHES.map((b) => (
                <Bar key={b} dataKey={b} fill={BRANCH_COLORS[b]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}