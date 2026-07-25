import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";

export default function ExpenseItemsTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["expense-items"],
    queryFn: () => base44.entities.ExpenseItem.list(),
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (name) => base44.entities.ExpenseItem.create({ name, is_active: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-items"] }); setNewName(""); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ExpenseItem.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-items"] }); setEditingId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ExpenseItem.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-items"] }),
  });

  const handleAdd = () => {
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  };

  const handleSaveEdit = (id) => {
    if (!editName.trim()) return;
    updateMutation.mutate({ id, data: { name: editName.trim() } });
  };

  const toggleActive = (item) => {
    updateMutation.mutate({ id: item.id, data: { is_active: !item.is_active } });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Plus className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">بنود المصروفات</h2>
          <p className="text-sm text-gray-500">إدارة بنود المصروفات المتاحة في تسليم الشيفت</p>
        </div>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label className="text-sm text-gray-600">إضافة بند جديد</Label>
            <Input
              placeholder="اسم البند (مثال: إيجار، كهرباء، مياه...)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <Button onClick={handleAdd} disabled={createMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            إضافة
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">لا توجد بنود مصروفات بعد</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اسم البند</TableHead>
                <TableHead className="text-center">نشط</TableHead>
                <TableHead className="text-left">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {editingId === item.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(item.id)}
                        className="max-w-xs"
                        autoFocus
                      />
                    ) : (
                      <span className="text-sm font-medium text-gray-700">{item.name}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={() => toggleActive(item)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      {editingId === item.id ? (
                        <>
                          <button onClick={() => handleSaveEdit(item.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => { setEditingId(item.id); setEditName(item.name); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(item.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}