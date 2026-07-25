export default function DailyProgressIndicator({ startDate, endDate, currentAmount, targetAmount, height = "h-8", color = "bg-green-500" }) {
  if (!targetAmount || targetAmount <= 0) return null;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  const totalDays = Math.max(Math.ceil((end - start) / 86400000) + 1, 1);
  const elapsedDays = Math.min(Math.max(Math.ceil((now - start) / 86400000) + 1, 1), totalDays);

  const timePercent = Math.min((elapsedDays / totalDays) * 100, 100);
  const actualPercent = targetAmount > 0 ? Math.min((currentAmount / targetAmount) * 100, 100) : 0;

  const expectedAmount = targetAmount * (timePercent / 100);
  const remaining = Math.max(targetAmount - currentAmount, 0);
  const diffFromExpected = currentAmount - expectedAmount;
  const isBehind = diffFromExpected < 0;
  const diffFromTarget = currentAmount - targetAmount;

  const fmt = (n) => Math.round(n).toLocaleString("ar-EG");

  // Status config
  const status = actualPercent >= 100
    ? { label: "تجاوز الهدف", color: "text-red-600", bg: "bg-red-50", ring: "ring-red-200", tube: { top: "#f87171", bottom: "#dc2626" } }
    : isBehind
    ? { label: "أقل من المعدل", color: "text-blue-600", bg: "bg-blue-50", ring: "ring-blue-200", tube: { top: "#60a5fa", bottom: "#2563eb" } }
    : { label: "ضمن المعدل", color: "text-green-600", bg: "bg-green-50", ring: "ring-green-200", tube: { top: "#4ade80", bottom: "#16a34a" } };

  return (
    <div className="space-y-2">
      {/* Top row: percentage + status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${status.color}`}>
            {actualPercent.toFixed(1)}%
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.bg} ${status.color} ring-1 ${status.ring}`}>
            {status.label}
          </span>
        </div>
        <div className="text-[11px] text-gray-400">
          اليوم {elapsedDays} من {totalDays}
        </div>
      </div>

      {/* Progress tube */}
      <div className="relative">
        <div className={`relative w-full ${height} bg-gray-100 rounded-full overflow-hidden border border-gray-200 shadow-inner`}>
          {/* Expected zone (light shading up to timePercent) */}
          <div
            className="absolute top-0 bottom-0 bg-gray-200/60"
            style={{ right: 0, width: `${100 - timePercent}%` }}
          />
          {/* Fill */}
          <div
            className="h-full rounded-full transition-all duration-700 relative"
            style={{
              width: `${actualPercent}%`,
              background: `linear-gradient(180deg, ${status.tube.top} 0%, ${status.tube.bottom} 100%)`,
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent rounded-full" />
          </div>

          {/* Expected marker line */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-gray-900 shadow-sm"
            style={{ right: `calc(${timePercent}% - 1px)` }}
          >
            <div className="absolute -top-1 right-1/2 translate-x-1/2 w-2 h-2 rotate-45 bg-gray-900" />
          </div>
        </div>

        {/* Marker label */}
        <div
          className="absolute -top-5 text-[9px] text-gray-500 font-medium whitespace-nowrap"
          style={{ right: `calc(${timePercent}% - 15px)` }}
        >
          متوقع {timePercent.toFixed(0)}%
        </div>
      </div>

      {/* Bottom: amounts */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">المنصرف:</span>
          <span className="font-semibold text-gray-700">{fmt(currentAmount)} ج</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">المتبقي:</span>
          <span className="font-semibold text-gray-700">{fmt(remaining)} ج</span>
        </div>
      </div>

      {/* Difference from expected */}
      <div className={`text-[11px] font-medium ${isBehind ? "text-blue-600" : "text-green-600"}`}>
        {isBehind
          ? `أقل من المعدل المتوقع بـ ${fmt(Math.abs(diffFromExpected))} ج`
          : `أعلى من المعدل المتوقع بـ ${fmt(diffFromExpected)} ج`}
        <span className="text-gray-400 mr-1">
          • {diffFromTarget >= 0 ? `+${fmt(diffFromTarget)}` : fmt(diffFromTarget)} ج عن التارجت
        </span>
      </div>
    </div>
  );
}