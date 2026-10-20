import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, CircleAlert } from 'lucide-react';
import { copyBConnectInvoiceNumber } from '@/lib/bconnectInvoiceClipboard';

function legacyCopy(value) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy') === true;
  } finally {
    document.body.removeChild(field);
  }
}

/** Copy action is separate from row selection and never changes an invoice. */
export default function CopyInvoiceNumber({ number, compact = false, className = '' }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => { setFeedback(''); }, [number]);
  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(''), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback, number]);

  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const ok = await copyBConnectInvoiceNumber(
      number,
      typeof navigator === 'undefined' ? null : navigator.clipboard,
      legacyCopy
    );
    setFeedback(ok ? 'copied' : 'failed');
  };

  const label = feedback === 'copied' ? 'تم النسخ' :
    feedback === 'failed' ? 'تعذر النسخ' : compact ? 'نسخ' : 'نسخ الرقم';
  const Icon = feedback === 'copied' ? Check : feedback === 'failed' ? CircleAlert : ClipboardCopy;
  const tone = feedback === 'copied'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : feedback === 'failed'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-teal-200 bg-white text-teal-700 hover:bg-teal-50';

  return <button
    type="button"
    aria-label={feedback === 'copied' ? 'تم نسخ رقم الفاتورة' : 'نسخ رقم الفاتورة'}
    title={feedback === 'failed' ? 'لم يسمح المتصفح بالنسخ؛ جرّب تحديد الرقم يدويًا' : 'نسخ رقم الفاتورة فقط'}
    disabled={number === null || number === undefined || String(number).trim() === ''}
    onClick={handleCopy}
    className={'inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-black transition disabled:opacity-40 ' + tone + ' ' + className}
  >
    <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    <span aria-live="polite">{label}</span>
  </button>;
}
