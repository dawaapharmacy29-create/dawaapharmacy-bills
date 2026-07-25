import { Building2 } from "lucide-react";

const BRANCH_OPTIONS = [
  { value: "all", label: "كل الفروع", activeClass: "bg-teal-600 text-white" },
  { value: "دواء الشامي", label: "دواء الشامي", activeClass: "bg-purple-600 text-white" },
  { value: "دواء شكري", label: "دواء شكري", activeClass: "bg-blue-600 text-white" },
];

export default function BranchSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-semibold text-gray-600 flex items-center gap-1 whitespace-nowrap">
        <Building2 className="w-4 h-4" /> عرض بيانات:
      </span>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {BRANCH_OPTIONS.map((b) => (
          <button
            key={b.value}
            onClick={() => onChange(b.value)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
              value === b.value ? b.activeClass : "text-gray-600 hover:bg-gray-200"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}