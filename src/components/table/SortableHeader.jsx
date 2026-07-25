import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * رأس عمود قابل للترتيب: 3 حالات (غير مرتب / تصاعدي / تنازلي).
 * - أيقونة واضحة بجانب الاسم.
 * - تمييز العمود النشط بلون.
 * - aria-sort + aria-label + دعم لوحة المفاتيح (Enter/Space).
 * - Tooltip عربي.
 */
export function SortableHeader({ field, label, sortField, sortDirection, onToggle, className = "" }) {
  const isActive = sortField === field && (sortDirection === "asc" || sortDirection === "desc");
  const Icon = !isActive ? ArrowUpDown : sortDirection === "asc" ? ArrowUp : ArrowDown;
  const ariaSort = !isActive ? "none" : sortDirection === "asc" ? "ascending" : "descending";
  const tooltip = !isActive
    ? "ترتيب تصاعدي"
    : sortDirection === "asc"
    ? "ترتيب تنازلي"
    : "إلغاء الترتيب";

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(field);
    }
  };

  return (
    <TableHead
      aria-sort={ariaSort}
      className={cn(
        "text-right cursor-pointer select-none transition-colors whitespace-nowrap",
        isActive ? "bg-teal-50/80 text-teal-800" : "hover:bg-gray-100",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(field)}
        onKeyDown={handleKeyDown}
        title={tooltip}
        aria-label={`${label} — ${tooltip}`}
        className="flex items-center gap-1 w-full h-full outline-none bg-transparent border-0 p-0 text-inherit font-inherit"
      >
        <span>{label}</span>
        <Icon className={cn("w-3 h-3 shrink-0", isActive ? "text-teal-600" : "text-gray-400")} />
      </button>
    </TableHead>
  );
}