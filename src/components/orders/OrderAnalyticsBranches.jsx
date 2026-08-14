const BRANCHES = ["دواء شكري", "دواء الشامي"];
export default function OrderAnalyticsBranches({ orders = [] }) {
  return <div className="grid md:grid-cols-2 gap-3">{BRANCHES.map((branch) => {
    const rows = orders.filter((o) => o.branch === branch);
    const done = rows.filter((o) => ["تم التوصيل", "تم توفير الصنف"].includes(o.status)).length;
    const rate = rows.length ? Math.round(done * 100 / rows.length) : 0;
    return <div key={branch} className="bg-white border rounded-2xl p-4"><div className="flex justify-between"><div><b>{branch}</b><div className="text-xs text-gray-500">{rows.length} طلب</div></div><span className="text-2xl font-black text-teal-700">{rate}%</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-3"><div className="h-full bg-teal-500" style={{ width: `${rate}%` }} /></div></div>;
  })}</div>;
}
