import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Lock, AlertTriangle, ShieldAlert, Eye, CheckCircle2, XCircle, DatabaseZap } from 'lucide-react';
import { base44ReviewApi } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUserRole } from '@/lib/useUserRole';
import { useToast } from '@/components/ui/use-toast';

const STATUS_TABS = [
  { key: 'pending', label: 'قيد الانتظار' },
  { key: 'needs_manual_apply', label: 'يحتاج تطبيق يدوي' },
  { key: 'acknowledged', label: 'تم الاطلاع' },
  { key: 'dismissed', label: 'تم التجاهل' },
  { key: 'all', label: 'الكل' },
];

const RISK_STYLE = {
  high: 'bg-red-100 text-red-700 border-red-200',
  elevated: 'bg-amber-100 text-amber-800 border-amber-200',
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
};

const ENTITY_LABELS = {
  ShiftDelivery: 'تسليم شيفت',
  SupplierPayment: 'دفعة مورد',
  PurchaseInvoice: 'فاتورة شراء',
};

function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ar-EG'); } catch { return value; }
}

function PayloadPreview({ label, payload }) {
  const entries = Object.entries(payload || {}).slice(0, 8);
  if (!entries.length) return <p className="text-xs text-gray-400">لا توجد بيانات</p>;
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold text-gray-500">{label}</p>
      <div className="space-y-0.5 rounded-lg bg-gray-50 p-2 text-[11px]">
        {entries.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <span className="text-gray-400">{key}</span>
            <span className="truncate font-medium text-gray-700" dir="auto">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Base44SyncReview() {
  const { isAdmin } = useUserRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState('pending');
  const [notesDraft, setNotesDraft] = useState({});

  const query = useQuery({
    queryKey: ['base44-sync-review', status],
    queryFn: () => base44ReviewApi.pendingList({ status }),
    enabled: isAdmin,
    staleTime: 15000,
    refetchInterval: 60000,
  });

  const markMutation = useMutation({
    mutationFn: ({ id, decision, notes }) => base44ReviewApi.mark(id, decision, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['base44-sync-review'] });
      toast({ title: 'تم تحديث حالة المراجعة' });
    },
    onError: (error) => toast({ title: 'تعذر تحديث الحالة', description: error.message, variant: 'destructive' }),
  });

  if (!isAdmin) {
    return <div dir="rtl" className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-gray-400"><Lock className="w-12 h-12" /><p>هذه الصفحة للمدير العام فقط</p></div>;
  }

  const rows = query.data?.rows || [];
  const pendingTotal = Number(query.data?.pending_total || 0);

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-50 p-2.5"><DatabaseZap className="h-6 w-6 text-amber-700" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">مراجعة مزامنة Base44</h1>
            <p className="mt-1 text-sm text-gray-500">مراقبة الفروقات والاستثناءات الواردة من Base44 إلى Supabase. فواتير الشراء العادية تُطبّق تلقائيًا، بينما الحذف والتعارضات الحساسة تتوقف للمراجعة الآمنة.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /> تحديث
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>المزامنة الرسمية تعمل في اتجاه واحد فقط: Base44 ← المصدر التشغيلي، ثم Supabase/Vercel للمراجعة والتحليل. التغييرات لا تُرسل من Vercel إلى Base44. الحذف والتعارضات لا تُطبق تلقائيًا حفاظًا على البيانات.</p>
        </div>
      </Card>

      {pendingTotal > 0 && <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">فيه {pendingTotal} سجل لسه قيد الانتظار في كل الحالات (بغض النظر عن التبويب المفتوح).</Card>}

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Button key={tab.key} size="sm" variant={status === tab.key ? 'default' : 'outline'} onClick={() => setStatus(tab.key)}>{tab.label}</Button>
        ))}
      </div>

      {query.isError && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">تعذر تحميل قائمة المراجعة: {query.error?.message}. لو الخطأ "42883" أو رسالة عن دالة غير موجودة، يبقى محتاج تطبيق ملف migration الخاص بيها على قاعدة بيانات Supabase أولًا.</Card>}

      {query.isLoading ? (
        <Card className="p-10 text-center text-sm text-gray-500">جاري التحميل...</Card>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-gray-400">لا توجد سجلات في هذا التبويب.</Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className={`p-4 border ${row.risk_level === 'high' ? 'border-red-200' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge className={`border ${RISK_STYLE[row.risk_level] || RISK_STYLE.normal}`}>{row.risk_level === 'high' ? 'خطورة عالية' : row.risk_level === 'elevated' ? 'خطورة متوسطة' : 'عادي'}</Badge>
                  <span className="font-bold text-gray-800">{ENTITY_LABELS[row.source_entity] || row.source_entity}</span>
                  <span className="text-xs text-gray-400">#{row.source_record_id}</span>
                </div>
                <span className="text-xs text-gray-400">{formatDate(row.created_at)}</span>
              </div>
              <p className="mt-2 text-sm text-gray-600">التصنيف: <span className="font-semibold">{row.classification}</span></p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <PayloadPreview label="البيانات من Base44" payload={row.source_payload} />
                <PayloadPreview label="المطابق الحالي في النظام (إن وجد)" payload={row.target_payload} />
              </div>
              {row.review_notes && <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-500">ملاحظات سابقة: {row.review_notes}</p>}
              {row.review_status === 'pending' || row.review_status === 'needs_manual_apply' ? (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <input
                    value={notesDraft[row.id] || ''}
                    onChange={(event) => setNotesDraft((old) => ({ ...old, [row.id]: event.target.value }))}
                    placeholder="ملاحظة اختيارية عن قرارك (مثلاً: اتسجل يدوي في فاتورة رقم ...)"
                    className="w-full rounded-lg border p-2 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => markMutation.mutate({ id: row.id, decision: 'acknowledged', notes: notesDraft[row.id] })} disabled={markMutation.isPending}>
                      <Eye className="h-3.5 w-3.5" /> تم الاطلاع (لا يحتاج تطبيق)
                    </Button>
                    <Button size="sm" className="gap-1 bg-amber-600 hover:bg-amber-700" onClick={() => markMutation.mutate({ id: row.id, decision: 'needs_manual_apply', notes: notesDraft[row.id] })} disabled={markMutation.isPending}>
                      <AlertTriangle className="h-3.5 w-3.5" /> يحتاج تطبيق يدوي
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1" onClick={() => markMutation.mutate({ id: row.id, decision: 'dismissed', notes: notesDraft[row.id] })} disabled={markMutation.isPending}>
                      <XCircle className="h-3.5 w-3.5" /> تجاهل (مكرر أو خطأ)
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> تمت مراجعته {row.reviewed_at ? `بتاريخ ${formatDate(row.reviewed_at)}` : ''}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
