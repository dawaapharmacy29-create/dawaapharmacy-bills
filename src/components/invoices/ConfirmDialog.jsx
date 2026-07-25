import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, confirmLabel = "موافق", confirmClass = "bg-red-600 hover:bg-red-700" }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{title}</DialogTitle>
        </DialogHeader>
        {description && <p className="text-sm text-gray-600 text-right">{description}</p>}
        <DialogFooter className="gap-2 flex-row-reverse">
          <Button className={confirmClass} onClick={() => { onConfirm(); onOpenChange(false); }}>{confirmLabel}</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}