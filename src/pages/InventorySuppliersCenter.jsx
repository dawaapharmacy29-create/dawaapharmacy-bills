import { Link } from 'react-router-dom';
import { Building2, HandCoins, PackageSearch, PackageX, FlaskConical, ShoppingBag, ClipboardList, ArrowLeftRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const sections = [
  { title: 'الموردون', description: 'بيانات الموردين وطرق التواصل والتعامل.', path: '/suppliers', icon: Building2 },
  { title: 'أرصدة الموردين', description: 'متابعة الأرصدة والمديونيات والحركات.', path: '/supplier-balances', icon: HandCoins },
  { title: 'الراكد والأكسبير', description: 'مراجعة الأصناف الراكدة وقريبة الانتهاء.', path: '/inventory', icon: PackageX },
  { title: 'الجرد الدوري', description: 'تنفيذ ومراجعة عمليات الجرد.', path: '/inventory-count', icon: ClipboardList },
  { title: 'أدوية اللستة', description: 'متابعة الأصناف الأساسية واللستة.', path: '/medicine-list', icon: FlaskConical },
  { title: 'الأصناف المطلوبة', description: 'النواقص والاحتياجات المقترحة للشراء.', path: '/replenishment', icon: PackageSearch },
  { title: 'طلبات العملاء', description: 'طلبات العملاء المفتوحة والمتابعة.', path: '/customer-orders', icon: ShoppingBag },
  { title: 'طلبات الصيدليات', description: 'طلبات الفروع والتحويلات المطلوبة.', path: '/pharmacy-orders', icon: ArrowLeftRight },
];

export default function InventorySuppliersCenter() {
  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">مركز المخزون والموردين</h1>
      <p className="mt-1 text-sm text-slate-500">نقطة دخول موحدة لكل أعمال المخزون والنواقص والموردين، مع بقاء الصفحات الحالية كما هي.</p>
    </div>

    <Card className="border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
      الدورة المقترحة: مراجعة النواقص والطلبات ← فحص فائض الفروع ← مراجعة الراكد والأكسبير ← إعداد الطلبية ← متابعة المورد والرصيد.
    </Card>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((item) => {
        const Icon = item.icon;
        return <Card key={item.path} className="p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-teal-50 p-3"><Icon className="h-5 w-5 text-teal-700" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-slate-900">{item.title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link to={item.path}>فتح الصفحة</Link></Button>
        </Card>;
      })}
    </div>
  </div>;
}
