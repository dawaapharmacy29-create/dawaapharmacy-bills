import { ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * أدوات الترتيب: زر إلغاء الترتيب (كل الشاشات) + قائمة "ترتيب حسب" للموبايل.
 */
export function SortControls({ columns, sortField, sortDirection, onToggle, onSet, onReset, activeLabel, cardMode = false }) {
  const isActive = sortField && sortDirection;
  const DirIcon = sortDirection === "desc" ? ArrowDown : ArrowUp;
  const menuWrapper = cardMode ? "flex items-center gap-1.5" : "md:hidden flex items-center gap-1.5";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* قائمة اختيار العمود (موبايل دائمًا / الكل في صفحات البطاقات) */}
      <div className={menuWrapper}>
        <Select
          value={sortField || "__default"}
          onValueChange={(v) => {
            if (v === "__default") onReset();
            else onSet(v, sortField === v ? (sortDirection === "asc" ? "desc" : "asc") : "asc");
          }}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <ArrowUpDown className="w-3 h-3 ml-1 text-gray-400" />
            <SelectValue placeholder="ترتيب حسب" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default">الترتيب الافتراضي</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.field} value={c.field}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isActive && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => onSet(sortField, sortDirection === "asc" ? "desc" : "asc")}
            title={sortDirection === "asc" ? "ترتيب تنازلي" : "ترتيب تصاعدي"}
          >
            <DirIcon className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* زر إلغاء الترتيب */}
      {isActive && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 text-xs text-gray-500 hover:text-gray-700 gap-1")}
          onClick={onReset}
        >
          <X className="w-3.5 h-3.5" />
          إلغاء الترتيب
        </Button>
      )}
    </div>
  );
}