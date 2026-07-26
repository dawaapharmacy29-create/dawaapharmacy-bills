import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { base44, invoiceWorkflowApi } from '@/api/base44Client';
import { useUserRole } from '@/lib/useUserRole';
import InvoiceViewDialog from '@/components/invoices/InvoiceViewDialog';
import InvoiceFormDialog from '@/components/invoices/InvoiceFormDialog';
import { CheckCircle2, ClipboardCheck, Eye, FileEdit, RotateCcw, Search, Send, ShieldCheck, WalletCards } from 'lucide-react';

const STATUS_CONFIG = {
  draft: { label: 'مسودة', className: 'bg-slate-100 text-slate-700' },
  submitted: { label: 'في انتظار المراجعة', className: 'bg-amber-100 text-amber-800' },
  reviewed: { label: 'تمت المراجعة', className: 'bg-blue-100 text-blue-800' },
  returned: { label: 'مرتجعة للتصحيح', className: 'bg-red-100 text-red-800' },
  approved: { label: 'معتمدة ماليًا', className: 'bg-emerald-100 text-emerald-800' },
};

const TABS = ['all', 'draft', 'submitted', 'reviewed', 'returned', 'approved'];
const TAB_LABELS = { all: 'الكل', ...Object.fromEntries(Object.entries(STATUS_CONFIG).map(([key, value]) => [key, value.label])) };
const ERROR_MESSAGES = {
  forbidden: 'الحساب الحالي لا يملك صلاحية تنفيذ هذه الخطوة.',
  invalid_transition: 'لا يمكن تنفيذ هذه الخطوة من حالة الفاتورة الحالية.',
  note_required: 'اكتب سبب إعادة الفاتورة للتصحيح.',
  invoice_not_found: 'الفاتورة غير موجودة.',
};

export default function PendingInvoices() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user, isAdmin, canEnterInvoice, canReviewInvoice, canApproveInvoice } = useUserRole();
  const [tab, setTab] = useState('submitted');
  const [search, setSearch] = useState('');
  const [viewInvoice, setViewInvoice] = useState(null);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [actionState, setActionState] = useState(null);
  const [note, setNote] = useState('');

  const invoicesQuery = useQuery({
    queryKey: ['purchase-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-created_date', 10000, 0),
    staleTime: 30000,
    retry: 1,
  });

  const allInvoices = invoicesQuery.data || [];
  const branches = Array.isArray(user?.branch_ids) ? user.branch_ids : [];
  const branchInvoices = useMemo(() => {
    if (isAdmin || !branches.length) return allInvoices;
    return allInvoices.filter((invoice) => !invoice.branch || branches.includes(invoice.branch));
  }, [allInvoices, branches, isAdmin]);

  const counts = useMemo(() => {
    const result = { all: branchInvoices.length };
    Object.keys(STATUS_CONFIG).forEach((status) => {
      result[status] = branchInvoices.filter((invoice) => (invoice.workflow_status || 'approved') === status).length;
    });
    return result;
  }, [branchInvoices]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return branchInvoices.filter((invoice) => {
      const status = invoice.workflow_status || 'approved';
      if (tab !== 'all' && status !== tab) return false;
      if (!term) return true;
      return [invoice.system_invoice_number, invoice.supplier_invoice_number, invoice.supplier_name, invoice.branch, invoice.entered_by_name]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [branchInvoices, tab, search]);

  const workflowMutation = useMutation({
    mutationFn: async ({ invoice, action, note: actionNote }) => {
      if (action === 'submit') return invoiceWorkflowApi.submit(invoice.id, actionNote);
      if (action === 'review') return invoiceWorkflowApi.review(invoice.id, actionNote);
      if (action === 'approve') return invoiceWorkflowApi.approve(invoice.id, actionNote);
      if (action === 'return') return invoiceWorkflowApi.returnForCorrection(invoice.id, actionNote);
      if (action === 'reopen') return invoiceWorkflowApi.reopen(invoice.id, actionNote);
      throw new Error('unsupported_action');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['pending-invoices-count'] });
      toast({ title: 'تم تحديث حالة الفاتورة بنجاح' });
      setActionState(null);
      setNote('');
    },
    onError: (error) => toast({ title: 'تعذر تنفيذ الإجراء', description: ERROR_MESSAGES[error?.message] || error?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PurchaseInvoice.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      setEditingInvoice(null);
      toast({ title: 'تم حفظ تصحيح الفاتورة' });
    },
    onError: (error) => toast({ title: 'تعذر تعديل الفاتورة', description: ERROR_MESSAGES[error?.message] || error?.message, variant: 'destructive' }),
  });

  const openAction = (invoice, action) => {
    setActionState({ invoice, action });
    setNote('');
  };

  const actionLabel = (action) => ({ submit: 'إرسال للمراجعة', review: 'تأكيد المراجعة', approve: 'اعتماد مالي', return: 'إعادة للتصحيح', reopen: 'إعادة فتح الفاتورة' }[action] || action);

  const renderActions = (invoice) => {
    const status = invoice.workflow_status || 'approved';
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setViewInvoice(invoice)}><Eye className="h-3.5 w-3.5" /> عرض</Button>
        {canEnterInvoice && ['draft', 'returned'].includes(status) && (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditingInvoice(invoice)}><FileEdit className="h-3.5 w-3.5" /> تعديل</Button>
        )}
        {canEnterInvoice && ['draft', 'returned'].includes(status) && (
          <Button size="sm" className="gap-1 bg-teal-600 hover:bg-teal-700" onClick={() => openAction(invoice, 'submit')}><Send className="h-3.5 w-3.5" /> إرسال للمراجعة</Button>
        )}
        {canReviewInvoice && status === 'submitted' && (
          <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => openAction(invoice, 'review')}><ClipboardCheck className="h-3.5 w-3.5" /> تمت المراجعة</Button>
        )}
        {(canReviewInvoice || canApproveInvoice) && ['submitted', 'reviewed'].includes(status) && (
          <Button size="sm" variant="outline" className="gap-1 border-red-300 text-red-700" onClick={() => openAction(invoice, 'return')}><RotateCcw className="h-3.5 w-3.5" /> إعادة للتصحيح</Button>
        )}
        {canApproveInvoice && status === 'reviewed' && (
          <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => openAction(invoice, 'approve')}><WalletCards className="h-3.5 w-3.5" /> اعتماد مالي</Button>
        )}
        {isAdmin && status === 'approved' && (
          <Button size="sm" variant="outline" onClick={() => openAction(invoice, 'reopen')}>إعادة فتح</Button>
        )}
      </div>
    );
  };

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-50 p-3"><ShieldCheck className="h-6 w-6 text-amber-700" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">دورة مراجعة واعتماد الفواتير</h1>
            <p className="mt-1 text-sm text-gray-500">كل خطوة مسجلة باسم المستخدم ووقتها، من إدخال الفاتورة حتى الاعتماد المالي.</p>
          </div>
        </div>
        <Badge variant="outline">الدور الحالي: {user?.display_name || user?.username}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(STATUS_CONFIG).map(([status, config]) => (
          <Card key={status} className="p-4">
            <p className="text-xs text-gray-500">{config.label}</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{counts[status] || 0}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2 border-b pb-4">
          {TABS.map((status) => (
            <button key={status} onClick={() => setTab(status)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === status ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {TAB_LABELS[status]} ({counts[status] || 0})
            </button>
          ))}
        </div>
        <div className="relative mt-4 max-w-md">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم الفاتورة أو المورد أو الفرع..." className="pr-10" />
        </div>
      </Card>

      {invoicesQuery.isLoading ? (
        <Card className="p-10 text-center text-gray-500">جاري تحميل الفواتير...</Card>
      ) : invoicesQuery.isError ? (
        <Card className="border-red-200 p-6 text-center text-red-700">{invoicesQuery.error?.message}</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((invoice) => {
            const status = invoice.workflow_status || 'approved';
            const config = STATUS_CONFIG[status] || STATUS_CONFIG.approved;
            return (
              <Card key={invoice.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-gray-900">فاتورة {invoice.system_invoice_number || 'بدون رقم'}</p>
                      <Badge className={`${config.className} border-0`}>{config.label}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">{invoice.supplier_name || 'مورد غير محدد'} — {invoice.branch || 'فرع غير محدد'}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>القيمة: {Number(invoice.total_value || 0).toLocaleString('ar-EG')} ج</span>
                      <span>التاريخ: {invoice.invoice_date || '—'}</span>
                      <span>أدخلها: {invoice.entered_by_name || 'بيانات منقولة'}</span>
                      {invoice.reviewed_by_name && <span>راجعها: {invoice.reviewed_by_name}</span>}
                      {invoice.approved_by_name && <span>اعتمدها: {invoice.approved_by_name}</span>}
                    </div>
                    {invoice.review_note && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">ملاحظة المراجعة: {invoice.review_note}</p>}
                  </div>
                  {renderActions(invoice)}
                </div>
              </Card>
            );
          })}
          {!filtered.length && <Card className="p-10 text-center text-gray-400"><CheckCircle2 className="mx-auto mb-3 h-10 w-10" />لا توجد فواتير في هذه المرحلة.</Card>}
        </div>
      )}

      <InvoiceViewDialog open={!!viewInvoice} onOpenChange={(open) => !open && setViewInvoice(null)} invoice={viewInvoice} />
      <InvoiceFormDialog
        open={!!editingInvoice}
        onOpenChange={(open) => !open && setEditingInvoice(null)}
        invoice={editingInvoice}
        allInvoices={allInvoices}
        isLoading={updateMutation.isPending}
        onSubmit={(data) => updateMutation.mutate({ id: editingInvoice.id, data })}
      />

      <Dialog open={!!actionState} onOpenChange={(open) => !open && setActionState(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader><DialogTitle>{actionLabel(actionState?.action)}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">الفاتورة: {actionState?.invoice?.system_invoice_number || '—'}</p>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={actionState?.action === 'return' ? 'سبب الإعادة للتصحيح — مطلوب' : 'ملاحظة اختيارية'} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setActionState(null)}>إلغاء</Button>
            <Button
              disabled={workflowMutation.isPending || (actionState?.action === 'return' && !note.trim())}
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => workflowMutation.mutate({ ...actionState, note })}
            >
              {workflowMutation.isPending ? 'جاري التنفيذ...' : 'تأكيد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
