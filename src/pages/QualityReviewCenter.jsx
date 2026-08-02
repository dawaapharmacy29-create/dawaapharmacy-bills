import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Database,
  DatabaseZap,
  FileSearch,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/lib/useUserRole';

const generalSections = [
  {
    title: 'جودة وأخطاء الفواتير',
    description: 'مراجعة جودة البيانات والأخطاء والتكرارات قبل الاعتماد.',
    path: '/invoices/quality',
    icon: ClipboardCheck,
  },
  {
    title: 'فواتير تحتاج مراجعة',
    description: 'الوصول المباشر للفواتير التي تحتاج قرارًا أو استكمال بيانات.',
    path: '/review-needed-invoices',
    icon: AlertTriangle,
  },
  {
    title: 'سجل العمليات',
    description: 'مراجعة الحركات والتعديلات التي تمت داخل التطبيق.',
    path: '/activity-log',
    icon: Activity,
  },
];

const adminSections = [
  {
    title: 'مركز مراجعة البيانات',
    description: 'مراجعة التعارضات والسجلات غير المكتملة ومشكلات جودة البيانات.',
    path: '/data-review',
    icon: Database,
  },
  {
    title: 'مراجعة مزامنة Base44',
    description: 'متابعة الاستثناءات والحذف والتعارضات القادمة من المصدر الأساسي.',
    path: '/base44-sync-review',
    icon: DatabaseZap,
  },
  {
    title: 'سجل الأمان',
    description: 'مراجعة الأنشطة الحساسة ومحاولات الوصول وتغييرات الصلاحيات.',
    path: '/security-audit',
    icon: ShieldCheck,
  },
  {
    title: 'مراجعة عمليات المشتريات',
    description: 'متابعة الاختناقات وجودة التنفيذ ومؤشرات الالتزام التشغيلي.',
    path: '/purchase-operations-review',
    icon: FileSearch,
  },
];

export default function QualityReviewCenter() {
  const { isAdmin } = useUserRole();
  const sections = isAdmin ? [...generalSections, ...adminSections] : generalSections;

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">مركز المراجعة والجودة</h1>
        <p className="mt-1 text-sm text-slate-500">
          نقطة دخول موحدة لمراجعة الفواتير وجودة البيانات والمزامنة والسجلات، مع احترام صلاحيات كل مستخدم.
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        دورة المراجعة المقترحة: أخطاء الفواتير ← السجلات التي تحتاج قرارًا ← تعارضات البيانات والمزامنة ← سجل العمليات والأمان.
        لا يتم تعديل أي سجل من هذه الصفحة؛ كل إجراء يتم داخل صفحته الأصلية وبصلاحياته الحالية.
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.path} className="p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-teal-50 p-3">
                  <Icon className="h-5 w-5 text-teal-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-slate-900">{item.title}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                <Link to={item.path}>فتح الصفحة</Link>
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
