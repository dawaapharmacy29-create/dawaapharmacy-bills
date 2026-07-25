import ReplenishmentList from "@/components/pharmacy/ReplenishmentList";
import { ListOrdered } from "lucide-react";

export default function ReplenishmentPage() {
  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
          <ListOrdered className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">قائمة الأصناف المطلوبة</h1>
          <p className="text-xs text-gray-500">تتبع الأصناف التي تحتاج إلى طلب</p>
        </div>
      </div>
      <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 shadow-sm">
        <ReplenishmentList />
      </div>
    </div>
  );
}