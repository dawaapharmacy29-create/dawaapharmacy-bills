import { Calendar } from "lucide-react";

export default function DateRangeFilter({ fromDate, toDate, onFromChange, onToDateChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
        <Calendar className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs text-gray-500">من</span>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => onFromChange(e.target.value)}
          className="text-sm text-gray-700 outline-none bg-transparent"
        />
      </div>
      <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
        <Calendar className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs text-gray-500">إلى</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => onToDateChange(e.target.value)}
          className="text-sm text-gray-700 outline-none bg-transparent"
        />
      </div>
      {(fromDate || toDate) && (
        <button
          onClick={() => { onFromChange(""); onToDateChange(""); }}
          className="text-xs text-red-500 hover:text-red-700 px-2"
        >
          مسح
        </button>
      )}
    </div>
  );
}