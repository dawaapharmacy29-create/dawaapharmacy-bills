import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rankSupplierSuggestions, supplierSuggestionLabel } from '@/lib/bconnectSupplierMatcher';

export default function BConnectSupplierSuggestions({ sourceName, suppliers, selectedId, onSelect, disabled = false }) {
  const suggestions = rankSupplierSuggestions(sourceName, suppliers, { limit: 3, minScore: 0.72 });
  if (!sourceName || !suggestions.length) return null;

  const top = suggestions[0];
  const ambiguous = suggestions.length > 1 && Math.abs(top.matchScore - suggestions[1].matchScore) < 0.08;

  return <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/70 p-3">
    <div className="flex items-center gap-2 text-xs font-black text-teal-800"><Sparkles className="h-4 w-4" />اقتراح ذكي للمورد</div>
    <div className="mt-1 text-[11px] leading-5 text-teal-700">
      قرأنا اسم B-Connect وقارنّاه بالموردين المسجلين. اختر الاقتراح الصحيح لتأكيده قبل التسجيل.
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {suggestions.map((supplier, index) => {
        const selected = String(selectedId || '') === String(supplier.id);
        const label = index === 0 && !ambiguous ? `الاقتراح الأقوى: ${supplier.name}` : supplier.name;
        return <Button
          key={supplier.id}
          type="button"
          size="sm"
          variant={selected ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => onSelect(supplier.id)}
          className="h-auto min-h-9 whitespace-normal text-right"
          title={`${supplierSuggestionLabel(supplier.matchScore)} — ${Math.round(supplier.matchScore * 100)}%`}
        >
          {selected ? '✓ ' : ''}{label}
        </Button>;
      })}
    </div>
    <div className="mt-2 text-[11px] text-teal-700">
      {ambiguous ? 'وجدنا أكثر من اسم قريب؛ اختر الصحيح يدويًا.' : `${supplierSuggestionLabel(top.matchScore)}. لن يتم اختيار أو إنشاء مورد تلقائيًا بدون ضغطك.`}
    </div>
  </div>;
}
