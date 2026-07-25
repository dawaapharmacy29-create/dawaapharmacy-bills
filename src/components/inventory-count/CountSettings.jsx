import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings2, Save } from "lucide-react";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const defaultSettings = (branch) => ({
  branch,
  items_per_day: 20,
  working_days: [0, 1, 2, 3, 4],
  priority_fast_moving: true,
  priority_expensive: true,
  priority_near_expiry: true,
  priority_random: true,
  priority_repeated_discrepancy: true,
});

export default function CountSettings({ branch, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(defaultSettings(branch));

  const { data: allSettings = [] } = useQuery({
    queryKey: ["inventory-settings"],
    queryFn: () => base44.entities.InventorySettings.list(),
  });

  const existing = allSettings.find(s => s.branch === branch);

  useEffect(() => {
    if (existing) setForm({ ...defaultSettings(branch), ...existing });
  }, [existing, branch]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (existing) return base44.entities.InventorySettings.update(existing.id, data);
      return base44.entities.InventorySettings.create(data);
    },
    onSuccess: () => { qc.invalidateQueries(["inventory-settings"]); onClose?.(); }
  });

  const toggleDay = (day) => {
    setForm(prev => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter(d => d !== day)
        : [...prev.working_days, day]
    }));
  };

  const priorities = [
    { key: "priority_fast_moving", label: "سريع الحركة" },
    { key: "priority_expensive", label: "غالي السعر" },
    { key: "priority_near_expiry", label: "قريب انتهاء الصلاحية" },
    { key: "priority_random", label: "عشوائي" },
    { key: "priority_repeated_discrepancy", label: "فارق متكرر" },
  ];

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex items-center gap-2 text-teal-700">
        <Settings2 className="w-5 h-5" />
        <h3 className="font-bold text-base">إعدادات الجرد — {branch}</h3>
      </div>

      <div className="space-y-2">
        <Label>عدد الأصناف يومياً</Label>
        <Input
          type="number" min={1} max={200}
          value={form.items_per_day}
          onChange={e => setForm(p => ({ ...p, items_per_day: Number(e.target.value) }))}
          className="w-32"
        />
      </div>

      <div className="space-y-2">
        <Label>أيام العمل</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <button
              key={i}
              onClick={() => toggleDay(i)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                form.working_days?.includes(i)
                  ? "bg-teal-600 text-white border-teal-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-teal-400"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>قواعد الأولوية في اختيار الأصناف</Label>
        <div className="space-y-2">
          {priorities.map(p => (
            <label key={p.key} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={form[p.key]}
                onCheckedChange={v => setForm(prev => ({ ...prev, [p.key]: !!v }))}
              />
              <span className="text-sm text-gray-700">{p.label}</span>
            </label>
          ))}
        </div>
      </div>

      <Button
        className="w-full gap-2 bg-teal-600 hover:bg-teal-700"
        onClick={() => saveMutation.mutate(form)}
        disabled={saveMutation.isPending}
      >
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? "جاري الحفظ..." : "حفظ الإعدادات"}
      </Button>
    </div>
  );
}