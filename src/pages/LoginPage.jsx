import { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const ERROR_MESSAGES = {
  invalid_credentials: 'اسم المستخدم أو الرقم السري غير صحيح.',
  account_disabled: 'الحساب موقوف. راجع المدير العام.',
  account_locked: 'تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة.',
  network_error: 'تعذر الوصول إلى Supabase. أعد المحاولة بعد تحديث الصفحة.',
};

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!username.trim() || !pin.trim()) {
      setError('اكتب اسم المستخدم والرقم السري.');
      return;
    }
    setLoading(true);
    const result = await login(username, pin);
    setLoading(false);
    if (!result?.ok) {
      setError(result?.message || ERROR_MESSAGES[result?.error] || 'تعذر تسجيل الدخول.');
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-xl border border-teal-100 overflow-hidden">
          <div className="bg-teal-600 px-8 py-7 text-center">
            <div className="mx-auto mb-4 w-full max-w-[280px] rounded-2xl bg-white p-3 shadow-sm">
              <img src="/dawaa-logo.svg" alt="شعار صيدليات دواء" className="w-full h-auto" />
            </div>
            <p className="text-teal-50 font-medium">نظام المشتريات والحسابات</p>
          </div>

          <form onSubmit={submit} className="p-7 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">اسم المستخدم</label>
              <div className="relative">
                <UserRound className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  autoComplete="username"
                  placeholder="مثال: dr.moaz"
                  className="w-full h-12 pr-11 pl-4 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-left"
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">الرقم السري</label>
              <div className="relative">
                <LockKeyhole className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="current-password"
                  placeholder="••••"
                  className="w-full h-12 pr-11 pl-12 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-center tracking-[0.35em] text-lg"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowPin((value) => !value)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="إظهار أو إخفاء الرقم السري">
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 break-words">{error}</div>}

            <button disabled={loading} className="w-full h-12 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold transition-colors">
              {loading ? 'جاري تسجيل الدخول...' : 'دخول'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">تسجيل الدخول باسم المستخدم والرقم السري فقط</p>
      </div>
    </div>
  );
}
