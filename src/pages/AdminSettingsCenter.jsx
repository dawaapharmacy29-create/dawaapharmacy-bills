import { Link } from 'react-router-dom';
import { Users, UserRoundCheck, ArrowLeftRight, Activity, FileSearch, ShieldCheck, DatabaseZap, UserCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const sections = [
  { title: 'فريق العمل', description: 'مراجعة بيانات الموظفين والحسابات المرتبطة.', path: '/team-members', icon: UserCheck },
  { title: 'المستخدمون والصلاحيات', description: 'إدارة الحسابات والأدوار والصلاحيات.', path: '/user-management', icon: Users },
  { title: 'تغطية حسابات الدكاترة', description: 'كشف الدكاترة غير المرتبطين بحسابات صالحة.', path: '/doctor-account-coverage', icon: UserRoundCheck },
  { title: 'دمج الموظفين', description: 'مراجعة ومعالجة السجلات والحسابات المكررة.', path: '/team-merge', icon: ArrowLeftRight },
  { title: 'حالة النظام', description: 'مراقبة الاتصال والمزامنة والفحوص التشغيلية.', path: '/system-status', icon: Activity },
  { title: 'تطبيق قواعد الموردين', description: 'أداة صيانة إدارية لقواعد وتصنيفات الموردين.', path: '/supplier-rules-backfill', icon: FileSearch },
  { title: 'مراجعة مزامنة Base44', description: 'مراجعة التعارضات والأحداث التي تحتاج تدخلًا.', path: '/base44-sync-review', icon: DatabaseZap },
  { title: 'سجل الأمان', description: 'مراجعة العمليات والأحداث الحساسة داخل النظام.', path: '/security-audit', icon: ShieldCheck },
];

export default function AdminSettingsCenter() {
  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">مركز الإدارة والإعدادات</h1>
      <p className="mt-1 text-sm text-slate-500">نقطة دخول موحدة للوظائف الإدارية الحساسة. الوصول للصفحة والروابط محمي بصلاحية المدير العام.</p>
    </div>
    <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      تنبيه: الأدوات داخل هذا المركز قد تؤثر على الحسابات أو إعدادات النظام؛ افتح الأداة المطلوبة فقط بعد مراجعة الغرض والبيانات.
    </Card>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((item) => {
        const Icon = item.icon;
        return <Card key={item.path} className="p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-slate-100 p-3"><Icon className="h-5 w-5 text-slate-700" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-slate-900">{item.title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link to={item.path}>فتح الأداة</Link></Button>
        </Card>;
      })}
    </div>
  </div>;
}
