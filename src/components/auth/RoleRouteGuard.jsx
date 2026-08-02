import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useUserRole } from '@/lib/useUserRole';

export default function RoleRouteGuard({ children, adminOnly = false, managerOnly = false, permission = null }) {
  const location = useLocation();
  const role = useUserRole();

  const allowed = adminOnly
    ? role.isAdmin
    : managerOnly
      ? role.isManager
      : permission
        ? Boolean(role[permission])
        : true;

  if (allowed) return children;

  if (!role.user) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return (
    <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-2xl bg-red-50 p-4"><ShieldAlert className="h-10 w-10 text-red-600" /></div>
      <h1 className="text-xl font-bold text-slate-900">غير مسموح بالدخول لهذه الصفحة</h1>
      <p className="max-w-md text-sm text-slate-500">صلاحيات الحساب الحالي لا تسمح بفتح هذه الصفحة. تم منع الوصول على مستوى المسار نفسه، وليس بإخفاء الرابط فقط.</p>
    </div>
  );
}
