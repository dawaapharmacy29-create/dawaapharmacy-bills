import fs from 'node:fs';

function replaceRequired(content, find, replacement, file) {
  if (content.includes(replacement)) return content;
  if (!content.includes(find)) throw new Error(`Pattern not found in ${file}: ${find.slice(0, 120)}`);
  return content.replace(find, replacement);
}

const apiPath = 'src/api/base44Client.js';
let api = fs.readFileSync(apiPath, 'utf8');
api = replaceRequired(
  api,
  "export const performanceApi = {\n  dashboard: (params = {}) => callSecureRpc('app_dashboard_summary', {",
  "export const performanceApi = {\n  financialSummary: (params = {}) => callSecureRpc('app_purchase_financial_summary', {\n    p_branch: params.branch || 'all',\n    p_date_from: params.date_from || null,\n    p_date_to: params.date_to || null,\n  }),\n  dashboard: (params = {}) => callSecureRpc('app_dashboard_summary', {",
  apiPath,
);
fs.writeFileSync(apiPath, api);

const dashboardPath = 'src/pages/Dashboard.jsx';
let dashboard = fs.readFileSync(dashboardPath, 'utf8');

dashboard = replaceRequired(
  dashboard,
  "  const { data: suppliers = [] } = useQuery({ queryKey: [\"suppliers\"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });",
  "  const { data: financialSummary = {}, isError: financialSummaryError } = useQuery({\n    queryKey: [\"canonical-financial-summary\", monthStart, monthEnd, branch],\n    queryFn: () => performanceApi.financialSummary({ branch, date_from: monthStart, date_to: monthEnd }),\n    staleTime: 20000,\n    refetchOnWindowFocus: false,\n  });\n  const { data: suppliers = [] } = useQuery({ queryKey: [\"suppliers\"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });",
  dashboardPath,
);

dashboard = replaceRequired(
  dashboard,
  "  const totalInvoiceValue = branchMonthInvoices.reduce((sum, invoice) => sum + getInvoiceNetAmount(invoice, suppliers), 0);\n  const totalExpenses = branchMonthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);\n  const totalPayments = totalInvoiceValue + totalExpenses;\n  const targetPercent = displayedTarget > 0 ? Math.min(Math.round((totalPayments / displayedTarget) * 100), 100) : 0;\n  const pending = invoices.filter((invoice) => invoice.workflow_status === 'submitted').length;\n  const totalCashPurchases = branchMonthInvoices.filter((invoice) => !isInvoiceExcluded(invoice, suppliers).excluded).reduce((sum, invoice) => sum + getInvoiceCashAmount(invoice), 0);",
  "  const localNetPurchases = branchMonthInvoices.reduce((sum, invoice) => sum + getInvoiceNetAmount(invoice, suppliers), 0);\n  const localExpenses = branchMonthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);\n  const localPaidPurchases = branchMonthInvoices\n    .filter((invoice) => !isInvoiceExcluded(invoice, suppliers).excluded)\n    .reduce((sum, invoice) => sum + getInvoiceCashAmount(invoice), 0);\n  const totalNetPurchases = Number(financialSummary.net_purchases ?? localNetPurchases);\n  const totalExpenses = Number(financialSummary.expenses ?? localExpenses);\n  const totalPaidPurchases = Number(financialSummary.actual_paid_purchases ?? localPaidPurchases);\n  const totalCreditPurchases = Number(financialSummary.credit_purchases ?? Math.max(totalNetPurchases - totalPaidPurchases, 0));\n  const totalCashOutflow = Number(financialSummary.cash_outflow ?? (totalPaidPurchases + totalExpenses));\n  const targetPercent = displayedTarget > 0 ? Math.min(Math.round((totalNetPurchases / displayedTarget) * 100), 100) : 0;\n  const pending = Number(financialSummary.pending_count ?? invoices.filter((invoice) => invoice.workflow_status === 'submitted').length);",
  dashboardPath,
);

dashboard = replaceRequired(
  dashboard,
  "  const stats = [\n    { label: \"فواتير الفترة\", value: branchMonthInvoices.length, icon: FileText, color: \"text-teal-600\", bg: \"bg-teal-50\" },\n    { label: \"إجمالي قيمة المدفوعات\", value: `${money(totalPayments)} ج`, icon: TrendingUp, color: \"text-blue-600\", bg: \"bg-blue-50\" },\n    { label: \"مشتريات الكاش\", value: `${money(totalCashPurchases)} ج`, icon: Users, color: \"text-purple-600\", bg: \"bg-purple-50\" },\n    { label: \"المصروفات\", value: `${money(totalExpenses)} ج`, icon: Receipt, color: \"text-orange-600\", bg: \"bg-orange-50\" },\n  ];",
  "  const stats = [\n    { label: \"فواتير الفترة\", value: Number(financialSummary.invoice_count ?? branchMonthInvoices.length), icon: FileText, color: \"text-teal-600\", bg: \"bg-teal-50\" },\n    { label: \"صافي المشتريات\", value: `${money(totalNetPurchases)} ج`, icon: TrendingUp, color: \"text-blue-600\", bg: \"bg-blue-50\" },\n    { label: \"المدفوع فعليًا للمشتريات\", value: `${money(totalPaidPurchases)} ج`, icon: Users, color: \"text-purple-600\", bg: \"bg-purple-50\" },\n    { label: \"المشتريات الآجلة\", value: `${money(totalCreditPurchases)} ج`, icon: FileText, color: \"text-amber-600\", bg: \"bg-amber-50\" },\n    { label: \"المصروفات\", value: `${money(totalExpenses)} ج`, icon: Receipt, color: \"text-orange-600\", bg: \"bg-orange-50\" },\n    { label: \"التدفق النقدي الخارج\", value: `${money(totalCashOutflow)} ج`, icon: TrendingUp, color: \"text-red-600\", bg: \"bg-red-50\" },\n  ];",
  dashboardPath,
);

dashboard = dashboard.replaceAll('item.label === "إجمالي قيمة المدفوعات"', 'item.label === "صافي المشتريات"');
dashboard = dashboard.replace('currentAmount={totalPayments}', 'currentAmount={totalNetPurchases}');

dashboard = replaceRequired(
  dashboard,
  "      {invoicesError && <Card className=\"border-red-200 bg-red-50 p-3 text-sm text-red-700\">تعذر تحميل الفواتير. حدّث الصفحة أو أعد تسجيل الدخول.</Card>}",
  "      {invoicesError && <Card className=\"border-red-200 bg-red-50 p-3 text-sm text-red-700\">تعذر تحميل الفواتير. حدّث الصفحة أو أعد تسجيل الدخول.</Card>}\n      {financialSummaryError && <Card className=\"border-amber-200 bg-amber-50 p-3 text-sm text-amber-800\">تعذر تحميل الملخص المالي الموحد؛ يتم عرض الحساب المحلي مؤقتًا حتى إعادة الاتصال.</Card>}",
  dashboardPath,
);

fs.writeFileSync(dashboardPath, dashboard);
console.log('Canonical financial summary patch applied.');
