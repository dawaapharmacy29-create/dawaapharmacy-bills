import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Users, Zap, LayoutDashboard, PackageSearch, BarChart2, CalendarDays, Boxes } from "lucide-react";
import ProductUploader from "@/components/inventory-count/ProductUploader";
import WeeklyScheduleForm from "@/components/inventory-count/WeeklyScheduleForm";
import TaskGenerator from "@/components/inventory-count/TaskGenerator";
import AdminDashboard from "@/components/inventory-count/AdminDashboard";
import AccuracyReport from "@/components/inventory-count/AccuracyReport";
import EmployeeScheduleView from "@/components/inventory-count/EmployeeScheduleView";
import { useUserRole } from "@/lib/useUserRole";
import ProductsManager from "@/components/inventory-count/ProductsManager";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const TODAY = new Date().toISOString().split("T")[0];

export default function InventoryCount() {
  const { isAdmin } = useUserRole();
  const isPrivileged = isAdmin;

  const [branch, setBranch] = useState("دواء شكري");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [countingStarted, setCountingStarted] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["inventory-products"],
    queryFn: () => base44.entities.InventoryProduct.list(),
    staleTime: 60000,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["inventory-tasks", branch],
    queryFn: () => base44.entities.InventoryCountTask.filter({ branch }),
    staleTime: 15000,
  });

  // Find the most relevant task: in-progress first, then any scheduled (not expired)
  const isNotExpired = (t) => {
    const end = new Date(t.task_date + "T23:59:59");
    return (new Date() - end) / (1000 * 60 * 60) <= 24;
  };
  const todayTask = tasks.find(t => t.status === "جاري") ||
    tasks.filter(t => t.status === "مجدول" && isNotExpired(t))
      .sort((a, b) => a.task_date.localeCompare(b.task_date))[0] ||
    tasks.find(t => t.task_date === TODAY);
  const branchProducts = products.filter(p => p.branch === branch && p.is_active !== false);

  return (
    <div className="p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center">
            <PackageSearch className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">الجرد الدوري</h1>
            <p className="text-xs text-gray-500">{branchProducts.length} صنف — {branch}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Select value={branch} onValueChange={v => { setBranch(v); setCountingStarted(false); }}>
            <SelectTrigger className="w-40 border-teal-300 text-teal-700 font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>

          {isPrivileged && (
            <>
              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setUploadOpen(true)}>
                <Upload className="w-3.5 h-3.5" /> رفع أصناف
              </Button>
              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setScheduleOpen(true)}>
                <Users className="w-3.5 h-3.5" /> الجدول الأسبوعي
              </Button>
              <Button size="sm" className="gap-1 text-xs bg-teal-600 hover:bg-teal-700" onClick={() => setGenerateOpen(true)}>
                <Zap className="w-3.5 h-3.5" /> توليد مهمة
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5 gap-2 bg-transparent p-0 flex flex-wrap">
          {isPrivileged && (
            <TabsTrigger value="dashboard" className="rounded-lg px-4 py-2 text-sm font-semibold border data-[state=active]:bg-gray-800 data-[state=active]:text-white data-[state=active]:border-gray-800 border-gray-300 text-gray-600 bg-white gap-1.5">
              <LayoutDashboard className="w-4 h-4" /> لوحة المدير
            </TabsTrigger>
          )}

          <TabsTrigger value="schedule" className="rounded-lg px-4 py-2 text-sm font-semibold border data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:border-teal-700 border-gray-300 text-gray-600 bg-white gap-1.5">
            <CalendarDays className="w-4 h-4" /> مواعيد الجرد
          </TabsTrigger>
          {isPrivileged && (
            <TabsTrigger value="report" className="rounded-lg px-4 py-2 text-sm font-semibold border data-[state=active]:bg-gray-800 data-[state=active]:text-white data-[state=active]:border-gray-800 border-gray-300 text-gray-600 bg-white gap-1.5">
              <BarChart2 className="w-4 h-4" /> تقرير الدقة
            </TabsTrigger>
          )}
          {isPrivileged && (
            <TabsTrigger value="products" className="rounded-lg px-4 py-2 text-sm font-semibold border data-[state=active]:bg-gray-800 data-[state=active]:text-white data-[state=active]:border-gray-800 border-gray-300 text-gray-600 bg-white gap-1.5">
              <Boxes className="w-4 h-4" /> إدارة الأصناف
            </TabsTrigger>
          )}
        </TabsList>

        {isPrivileged && (
          <TabsContent value="dashboard">
            <AdminDashboard branch={branch} />
          </TabsContent>
        )}

        <TabsContent value="schedule">
          <EmployeeScheduleView />
        </TabsContent>

        {isPrivileged && (
          <TabsContent value="report">
            <AccuracyReport branch={branch} />
          </TabsContent>
        )}
        {isPrivileged && (
          <TabsContent value="products">
            <ProductsManager />
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <ProductUploader onClose={() => setUploadOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
          <WeeklyScheduleForm branch={branch} onClose={() => setScheduleOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <TaskGenerator
            branch={branch}
            products={products}
            onDone={() => setGenerateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}