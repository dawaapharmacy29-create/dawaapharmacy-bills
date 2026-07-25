import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXCLUSION_REASONS } from "@/lib/purchaseCalculations";

export default function BulkExcludeDialog({ open, onOpenChange, count, onConfirm }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) { setReason(""); setNote(""); }
  }, [open]);

  const handleConfirm = () => {
    if (!reason) return;
    onConfirm({ exclusion_reason: reason, exclusion_note: note });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>استثناء {count} فاتورة من صافي المشتريات</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>سبب الاستثناء *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-9"><SelectValue placeholder="اختر السبب" /></SelectTrigger>
              <SelectContent>
                {EXCLUSION_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="ملاحظات إضافية..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={!reason} onClick={handleConfirm}>
            استثناء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}