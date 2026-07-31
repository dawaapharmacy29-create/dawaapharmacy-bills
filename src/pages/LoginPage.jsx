import { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
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
    if (!result?.ok) setError(result?.message || ERROR_MESSAGES[result?.error] || 'تعذر تسجيل الدخول.');
  };

  return (
    <div dir="rtl" className="relative min-h-screen overflow-hidden bg-[#f5fbfa] px-4 py-8 lg:px-8">
      <div className="pointer-events-none absolute -right-32 -top-28 h-96 w-96 rounded-full bg-teal-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-cyan-200/35 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'radial-gradient(#0f766e 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

      <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 shadow-[0_30px_90px_rgba(15,118,110,0.16)] backdrop-blur-xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden min-h-[650px] overflow-hidden bg-gradient-to-br from-[#08273a] via-[#0b5361] to-[#0f9d8f] p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="absolute -left-24 top-24 h-72 w-72 rounded-full border border-white/10" />
            <div className="absolute -left-6 top-40 h-48 w-48 rounded-full border border-white/10" />
            <div className="absolute bottom-[-70px] right-[-40px] h-64 w-64 rounded-full bg-white/10 blur-2xl" />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur">
                <Sparkles className="h-4 w-4 text-teal-200" />
                نظام موحد للمشتريات والحسابات
              </div>
              <h1 className="mt-7 text-4xl font-black leading-tight">إدارة أوضح.<br />قرارات أسرع.<br />تشغيل أقوى.</h1>
              <p className="mt-5 max-w-md text-base leading-8 text-teal-50/90">تابع الفواتير والموردين وتسليمات الشيفت والخزنة من مكان واحد بهوية صيدليات دواء.</p>
            </div>

            <div className="relative z-10 rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white/15 p-3"><ShieldCheck className="h-6 w-6" /></div>
                <div><p className="font-bold">دخول آمن للموظفين</p><p className="mt-1 text-sm text-teal-50/80">كل حساب يرى الصلاحيات والفرع المخصص له فقط.</p></div>
              </div>
            </div>
          </section>

          <section className="flex min-h-[650px] items-center justify-center p-6 sm:p-10 lg:p-12">
            <div className="w-full max-w-md">
              <div className="text-center">
                <div className="mx-auto flex h-44 w-44 items-center justify-center overflow-hidden rounded-[2rem] border border-teal-100 bg-white p-3 shadow-[0_18px_45px_rgba(15,118,110,0.15)] sm:h-48 sm:w-48">
                  <img src="/dawaa-logo.jpg" alt="شعار صيدليات دواء" className="h-full w-full object-contain" />
                </div>
                <h2 className="mt-6 text-3xl font-black text-slate-900">صيدليات دواء</h2>
                <p className="mt-2 text-sm font-semibold text-teal-700">كل اللي تحتاجه وأكثر</p>
                <p className="mt-1 text-sm text-slate-500">نظام المشتريات والحسابات</p>
              </div>

              <form onSubmit={submit} className="mt-8 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">اسم المستخدم</label>
                  <div className="relative">
                    <UserRound className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-teal-600" />
                    <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" placeholder="مثال: dr.moaz" className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50/70 pr-12 pl-4 text-left outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100" dir="ltr" />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">الرقم السري</label>
                  <div className="relative">
                    <LockKeyhole className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-teal-600" />
                    <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} type={showPin ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password" placeholder="••••" className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50/70 pr-12 pl-12 text-center text-lg tracking-[0.35em] outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100" dir="ltr" />
                    <button type="button" onClick={() => setShowPin((value) => !value)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-teal-700" aria-label="إظهار أو إخفاء الرقم السري">
                      {showPin ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                {error && <div className="break-words rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

                <button disabled={loading} className="h-14 w-full rounded-2xl bg-gradient-to-l from-teal-600 to-cyan-700 font-bold text-white shadow-lg shadow-teal-600/20 transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
                </button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-teal-500" />دخول مخصص لموظفي صيدليات دواء</div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}