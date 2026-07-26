import React from 'react';
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Dawaa application error', error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  logout = () => {
    localStorage.removeItem('dawaa_staff_session');
    window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl border border-red-100 bg-white p-7 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">حدث خطأ أثناء فتح الصفحة</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            البيانات لم تُحذف. جرّب إعادة تحميل الصفحة، ولو تكرر الخطأ سجّل الخروج ثم ادخل مرة أخرى.
          </p>
          {this.state.error?.message && (
            <div dir="ltr" className="mt-4 max-h-28 overflow-auto rounded-xl bg-slate-900 p-3 text-left text-xs text-slate-100">
              {this.state.error.message}
            </div>
          )}
          <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={this.reset} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 font-bold text-white hover:bg-teal-700">
              <RefreshCw className="h-4 w-4" /> إعادة تحميل
            </button>
            <button onClick={this.logout} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 font-bold text-slate-700 hover:bg-slate-50">
              <LogOut className="h-4 w-4" /> تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }
}
