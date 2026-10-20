import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileWarning, RefreshCw, Search, Layers3, List } from "lucide-react";
import * as XLSX from "xlsx";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeText } from "@/lib/dataIntegrity";
import { canonicalizeInvoicePageRows, findInvoiceProgramNumberCollisions } from "@/lib/purchaseInvoiceCollisionAudit";
import { buildInvoiceQualityGroups, filterInvoiceQualityGroups, paginateInvoiceQualityGroups, isInvoiceQualityDuplicate } from "@/lib/invoiceQualityGrouping";

const PAGE_SIZE = 250;
const BRANCHES = ["دواء شكري", "دواء الشامي"];

const ISSUE_LABELS = {
  missing_supplier: "بدون مورد",
  missing_supplier_invoice: "بدون رقم فاتورة مورد",
  missing_system_invoice: "بدون رقم على البرنامج",
  zero_total: "قيمة صفر",
  invalid_return: "مرتجع أكبر من الفاتورة",
  invalid_branch: "فرع غير صحيح",
  future_date: "تاريخ مستقبلي",
  duplicate: "تكرار فاتورة المورد",
  duplicate_program: "تكرار رقم البرنامج بنفس الفرع",
};

async function loadAllInvoices() {
  const pageSize = 500;
  const rows = [];
  let offset = 0;
  while (true) {
    const batch = await base44.entities.PurchaseInvoice.list("-created_date", pageSize, offset);
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return canonicalizeInvoicePageRows(rows);
}

function issueTone(issue) {
  if (["invalid_return", "duplicate", "duplicate_program"].includes(issue)) return "bg-red-100 text-red-700 border-red-200";
  if (["missing_supplier", "invalid_branch", "future_date"].includes(issue)) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function InvoiceQualityCenter() {
  const [issueFilter, setIssueFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [groupDuplicates, setGroupDuplicates] = useState(true);

  const query = useQuery({
    queryKey: ["invoice-quality-center"],
    queryFn: loadAllInvoices,
    staleTime: 60000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const analysis = useMemo(() => {
    const invoices = query.data || [];
    const duplicateMap = new Map();

    invoices.forEach((inv) => {
      const supplierInvoice = normalizeText(inv.supplier_invoice_number);
      if (!supplierInvoice) return;
      const key = [normalizeText(inv.supplier_name), normalizeText(inv.branch), supplierInvoice].join("|");
      if (!duplicateMap.has(key)) duplicateMap.set(key, []);
      duplicateMap.get(key).push(inv.id);
    });

    const duplicateIds = new Set(
      [...duplicateMap.values()].filter((ids) => ids.length > 1).flat()
    );
    const duplicateProgramIds = new Set(
      [...findInvoiceProgramNumberCollisions(invoices).values()].flatMap((group) => group.map((row) => row.id))
    );

    const rows = invoices.map((inv) => {
      const issues = [];
      const total = Number(inv.total_value || 0);
      const returned = Number(inv.returned_value || 0);
      const invoiceDate = inv.invoice_date ? new Date(`${inv.invoice_date}T00:00:00`) : null;
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (!normalizeText(inv.supplier_name)) issues.push("missing_supplier");
      if (!normalizeText(inv.supplier_invoice_number) && inv.transaction_type !== "internal_transfer") issues.push("missing_supplier_invoice");
      if (!normalizeText(inv.system_invoice_number)) issues.push("missing_system_invoice");
      if (total <= 0) issues.push("zero_total");
      if (returned > total) issues.push("invalid_return");
      if (!BRANCHES.includes(inv.branch)) issues.push("invalid_branch");
      if (invoiceDate && invoiceDate >= tomorrow) issues.push("future_date");
      if (duplicateIds.has(inv.id)) issues.push("duplicate");
      if (duplicateProgramIds.has(inv.id)) issues.push("duplicate_program");

      return { ...inv, issues };
    }).filter((row) => row.issues.length > 0);

    const counts = Object.keys(ISSUE_LABELS).reduce((acc, key) => {
      acc[key] = rows.filter((row) => row.issues.includes(key)).length;
      return acc;
    }, {});

    return { rows, counts, totalInvoices: invoices.length };
  }, [query.data]);

  const candidates = useMemo(() => analysis.rows.filter((row) => {
    if (issueFilter === 'all_duplicates') {
      if (!isInvoiceQualityDuplicate(row)) return false;
    } else if (issueFilter !== 'all' && !row.issues.includes(issueFilter)) return false;
    return branchFilter === 'all' || row.branch === branchFilter;
  }), [analysis.rows, issueFilter, branchFilter]);

  // Group BEFORE applying search so a search for one supplier/date still
  // returns the other records of that same collision for comparison.
  const groupMode = issueFilter === 'duplicate_program' ? 'program' :
    issueFilter === 'duplicate' ? 'supplier' : 'all';
  const groups = useMemo(() => buildInvoiceQualityGroups(candidates, groupMode), [candidates, groupMode]);
  const matchingGroups = useMemo(() => filterInvoiceQualityGroups(groups, search), [groups, search]);
  const filtered = useMemo(() => {
    if (groupDuplicates) return matchingGroups.flatMap((group) => group.rows);
    const term = normalizeText(search);
    return candidates.filter((row) => !term || [row.system_invoice_number, row.supplier_invoice_number, row.supplier_name, row.entered_by, row.id]
      .some((value) => normalizeText(value).includes(term)));
  }, [groupDuplicates, matchingGroups, candidates, search]);

  const duplicateGroups = matchingGroups.filter((group) => group.isDuplicate);
  const groupPages = useMemo(() => paginateInvoiceQualityGroups(matchingGroups, PAGE_SIZE), [matchingGroups]);
  const totalPages = groupDuplicates
    ? groupPages.length
    : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroups = groupDuplicates
    ? (groupPages[currentPage - 1] || [])
    : [{
      key: 'ungrouped-page',
      isDuplicate: false,
      rows: filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    }];

  const updateFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const exportRows = () => {
    const rows = filtered.map((row) => ({
      "رقم البرنامج": row.system_invoice_number || "",
      "رقم فاتورة المورد": row.supplier_invoice_number || "",
      "المورد": row.supplier_name || "",
      "الفرع": row.branch || "",
      "التاريخ": row.invoice_date || "",
      "الإجمالي": Number(row.total_value || 0),
      "المرتجع": Number(row.returned_value || 0),
      "مدخل الفاتورة": row.entered_by || "",
      "المدفوع": Number(row.paid_value || 0),
      "حالة سير الفاتورة": row.workflow_status || "",
      "المشكلات": row.issues.map((issue) => ISSUE_LABELS[issue]).join("، "),
      "معرف السجل": row.id || "",
      "معرف المصدر": row.base44_id || row.source_record_id || "",
      "حالة المزامنة": row.base44_sync_state || "",
      "حالة مراجعة التكرار": row.duplicate_review_status || "",
      "وقت إنشاء السجل": row.created_at || row.created_date || "",
      "وقت آخر تعديل": row.updated_at || row.updated_date || "",
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "جودة الفواتير");
    XLSX.writeFile(workbook, `مراجعة-جودة-الفواتير-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (query.isLoading) {
    return <div dir="rtl" className="p-8 text-center text-slate-500">جاري فحص الفواتير...</div>;
  }

  if (query.isError) {
    return (
      <div dir="rtl" className="p-6">
        <Card className="p-6 text-center border-red-200 bg-red-50">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-bold text-red-800">تعذر فحص الفواتير</h2>
          <p className="text-sm text-red-600 mt-2">{query.error?.message || "حدث خطأ أثناء تحميل البيانات"}</p>
          <Button className="mt-4 gap-2" onClick={() => query.refetch()}><RefreshCw className="w-4 h-4" />إعادة المحاولة</Button>
        </Card>
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">مركز جودة الفواتير</h1>
          <p className="text-sm text-slate-500 mt-1">فحص فقط بدون حذف أو تعديل تلقائي لأي فاتورة.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`w-4 h-4 ${query.isFetching ? "animate-spin" : ""}`} />تحديث الفحص
          </Button>
          <Button className="gap-2 bg-teal-600 hover:bg-teal-700" onClick={exportRows} disabled={!filtered.length}>
            <Download className="w-4 h-4" />تصدير النتائج
          </Button>
        </div>
      </div>

      <Card className="p-5 flex items-center gap-4">
        {analysis.rows.length ? <FileWarning className="w-10 h-10 text-amber-500" /> : <CheckCircle2 className="w-10 h-10 text-emerald-500" />}
        <div>
          <p className="font-bold text-lg">{analysis.rows.length ? `${analysis.rows.length} فاتورة تحتاج مراجعة` : "لا توجد مشكلات ظاهرة"}</p>
          <p className="text-sm text-slate-500">تم فحص {analysis.totalInvoices.toLocaleString("ar-EG")} فاتورة. قد تحمل الفاتورة أكثر من ملاحظة.</p>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(ISSUE_LABELS).map(([key, label]) => (
          <button key={key} onClick={() => { setIssueFilter(key); setPage(1); }} className="text-right">
            <Card className={`p-3 border transition hover:shadow-sm ${analysis.counts[key] ? "border-amber-200" : "border-emerald-100"}`}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-xl font-bold mt-1">{analysis.counts[key] || 0}</p>
            </Card>
          </button>
        ))}
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="بحث برقم الفاتورة أو المورد أو الدكتور" className="pr-9" />
          </div>
          <Select value={issueFilter} onValueChange={updateFilter(setIssueFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل أنواع المشكلات</SelectItem>
              <SelectItem value="all_duplicates">كل أنواع التكرار</SelectItem>
              {Object.entries(ISSUE_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={branchFilter} onValueChange={updateFilter(setBranchFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {BRANCHES.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-600">
            <span>النتائج الحالية: <strong>{filtered.length.toLocaleString("ar-EG")}</strong> سجل</span>
            {groupDuplicates && duplicateGroups.length > 0 && <span className="mr-2">· <strong>{duplicateGroups.length.toLocaleString("ar-EG")}</strong> مجموعة متعارضة</span>}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button type="button" aria-pressed={groupDuplicates} onClick={() => { setGroupDuplicates(true); setPage(1); }}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold ${groupDuplicates ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white'}`}>
              <Layers3 className="h-3.5 w-3.5" /> تجميع المتكررات
            </button>
            <button type="button" aria-pressed={!groupDuplicates} onClick={() => { setGroupDuplicates(false); setPage(1); }}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold ${!groupDuplicates ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white'}`}>
              <List className="h-3.5 w-3.5" /> عرض عادي
            </button>
          </div>
        </div>
        {groupDuplicates && <p className="text-[11px] text-slate-500">كل مجموعة لها نفس رقم البرنامج داخل الفرع أو نفس مرجع فاتورة المورد. السجلات تظل منفصلة؛ التجميع للعرض فقط، ولا يعني ثبوت التكرار المحاسبي.</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1050px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-3 text-right">رقم البرنامج</th>
                <th className="p-3 text-right">رقم المورد</th>
                <th className="p-3 text-right">المورد</th>
                <th className="p-3 text-right">الفرع</th>
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">الإجمالي</th>
                <th className="p-3 text-right">مدخل الفاتورة</th>
                <th className="p-3 text-right">الملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">لا توجد نتائج مطابقة.</td></tr>
              ) : pageGroups.map((group) => (
                <Fragment key={group.key}>
                  {groupDuplicates && group.isDuplicate && (
                    <tr className="border-y border-teal-200 bg-teal-50/80">
                      <td colSpan={8} className="px-3 py-2.5 text-xs font-black text-teal-950">
                        <div className="flex flex-wrap items-center gap-2">
                          <Layers3 className="h-4 w-4" />
                          <span>{group.kind === 'program'
                            ? `رقم البرنامج ${group.programNumber}`
                            : group.kind === 'supplier'
                              ? `فاتورة المورد ${group.supplierNumber}`
                              : `مجموعة أرقام مرتبطة: ${group.numbers.join('، ')}`}</span>
                          <span>· {group.branch}</span>
                          <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5">{group.size} سجلات للمراجعة</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {group.rows.map((row, index) => (
                <tr key={row.id || `${group.key}:${index}`} className={`border-b last:border-0 hover:bg-slate-50/70 ${groupDuplicates && group.isDuplicate ? 'bg-teal-50/20' : ''}`}>
                  <td className="p-3 font-semibold">{row.system_invoice_number || "—"}</td>
                  <td className="p-3">{row.supplier_invoice_number || "—"}</td>
                  <td className="p-3">{row.supplier_name || "—"}</td>
                  <td className="p-3">{row.branch || "—"}</td>
                  <td className="p-3">{row.invoice_date || "—"}</td>
                  <td className="p-3 font-semibold">{Number(row.total_value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="p-3">{row.entered_by || "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {row.issues.map((issue) => <Badge key={issue} variant="outline" className={issueTone(issue)}>{ISSUE_LABELS[issue]}</Badge>)}
                    </div>
                  </td>
                </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 p-3 border-t bg-slate-50">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>السابق</Button>
          <span className="text-xs text-slate-600">صفحة {currentPage} من {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>التالي</Button>
        </div>
      </Card>
    </div>
  );
}
