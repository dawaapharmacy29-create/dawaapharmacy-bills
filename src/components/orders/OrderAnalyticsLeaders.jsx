function rank(orders, field, limit) {
  const map = {};
  orders.forEach((o) => { const key = o[field] || "غير محدد"; map[key] = (map[key] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit);
}
export default function OrderAnalyticsLeaders({ orders = [] }) {
  return <div className="grid md:grid-cols-2 gap-3"><List title="الأصناف الأكثر طلبًا" rows={rank(orders, "product_name", 10)} /><List title="العملاء الأكثر طلبًا" rows={rank(orders, "customer_name", 8)} /></div>;
}
function List({ title, rows }) { return <div className="bg-white border rounded-2xl p-4"><b className="text-sm text-gray-800">{title}</b><div className="space-y-2 mt-3">{rows.map(([name, count], i) => <div key={`${name}-${i}`} className="flex items-center gap-2 text-sm"><span className="w-5 text-gray-400">{i + 1}</span><span className="flex-1 truncate">{name}</span><b className="text-teal-700">{count}</b></div>)}</div></div>; }
