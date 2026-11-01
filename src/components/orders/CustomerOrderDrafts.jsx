import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customerOrderBatchApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

export default function CustomerOrderDrafts({ onEdit }) {
  const qc = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ['customer-order-drafts'], queryFn: () => customerOrderBatchApi.workflow('list_drafts') });
  const remove = async draft => {
    if (!window.confirm('حذف المسودة غير المعتمدة؟ لن تتأثر أي طلبات محفوظة.')) return;
    try { await customerOrderBatchApi.workflow('delete_draft', draft.id); await qc.invalidateQueries({queryKey:['customer-order-drafts']}); }
    catch(e) { window.alert(e.message || 'تعذر حذف المسودة'); }
  };
  return <section dir="rtl" className="rounded-xl border bg-white p-3 space-y-2">
    <div className="flex items-center justify-between"><h3 className="font-bold text-teal-800">مسودات الطلبات ({data.length})</h3><span className="text-xs text-slate-500">لا تدخل ضمن النواقص أو الطلبات المعتمدة</span></div>
    {isLoading && <p className="text-sm">جاري تحميل المسودات...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
    {data.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-2">
      <div className="text-sm"><b>{d.content?.form?.customer_name || 'عميل لم يُحدد بعد'}</b> · {d.branch} · {d.content?.draftLines?.length || 0} أصناف</div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>onEdit(d)}>استكمال / تعديل</Button><Button variant="outline" size="sm" className="text-red-700" onClick={()=>remove(d)}>حذف المسودة</Button></div>
    </div>)}
  </section>;
}
