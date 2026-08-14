export default function OrderAnalyticsPerformance({ orders = [] }) {
  const cards = [
    ["إجمالي الطلبات", orders.length],
    ["تم التوصيل", orders.filter((o) => o.status === "تم التوصيل").length],
    ["تم توفير الصنف", orders.filter((o) => o.status === "تم توفير الصنف").length],
    ["طلبات عاجلة", orders.filter((o) => o.priority === "عاجل").length],
    ["تم الإلغاء", orders.filter((o) => o.status === "تم الإلغاء").length],
  ];
  return <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
    {cards.map(([label, value]) => <div key={label} className="bg-white border rounded-2xl p-4"><div className="text-2xl font-black text-gray-900">{value}</div><div className="text-xs text-gray-500 mt-1">{label}</div></div>)}
  </div>;
}
