import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORY_LABELS } from "@/lib/purchaseCalculations";

const OPTIONS = [
  { value: "medicines", label: CATEGORY_LABELS.medicines },
  { value: "supplies_accessories", label: CATEGORY_LABELS.supplies_accessories },
  { value: "unclassified", label: CATEGORY_LABELS.unclassified },
];

export default function BulkCategoryDialog({ open, onOpenChange, count, onConfirm }) {
  const [category, setCategory] = useState("");

  useEffect(() => {
    if (open) setCategory("");
  }, [open]);

  const handleConfirm = () => {
    if (!category) return;
    onConfirm({ purchase_category: category, purchase_category_source: "manual" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تغيير تصنيف {count} فاتورة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>التصنيف الجديد *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
              <SelectContent>
                {OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" disabled={!category} onClick={handleConfirm}>
            تطبيق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}