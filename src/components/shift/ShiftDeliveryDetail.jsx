import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

const SHIFT_BADGE = {
  "صباحي": "bg-amber-100 text-amber-700",
  "مسائي": "bg-blue-100 text-blue-700",
  "ليلي": "bg-indigo-100 text-indigo-700",
};

export default function ShiftDeliveryDetail({ item, onClose }) {
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge className={SHIFT_BADGE[item.shift_type] || "bg-gray-100"}>{item.shift_type}</Badge>
            <span>{item.branch}</span>
            <span className="text-sm text-gray-400 font-normal">{item.shift_date}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs">الموظف</p>
              <p className="font-medium">{item.submitted_by || "—"}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">الحالة</p>
              <p className="font-medium">{item.status || "—"}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">المبيعات</p>
              <p className="font-bold text-blue-700 text-sm">{fmt(item.total_sales)}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">المصروفات</p>
              <p className="font-bold text-red-600 text-sm">{fmt(item.total_expenses)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">الصافي</p>
              <p className="font-bold text-green-600 text-sm">{fmt(item.net_amount)}</p>
            </div>
          </div>

          {item.expenses && item.expenses.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">بنود المصروفات</p>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الوصف</TableHead>
                      <TableHead>التصنيف</TableHead>
                      <TableHead className="text-left">القيمة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.expenses.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{e.description || "—"}</TableCell>
                        <TableCell className="text-sm">{e.category || "—"}</TableCell>
                        <TableCell className="text-sm font-medium text-red-600">{fmt(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {item.notes && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">ملاحظات</p>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{item.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}