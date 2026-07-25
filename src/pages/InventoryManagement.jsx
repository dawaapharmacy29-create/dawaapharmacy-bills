import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SlowMovingTab from "@/components/inventory/SlowMovingTab";
import ExpiredItemsTab from "@/components/inventory/ExpiredItemsTab";
import ReorderPointsTab from "@/components/inventory/ReorderPointsTab";

export default function InventoryManagement() {
  return (
    <div className="p-4 md:p-6" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">إدارة المخزون</h1>
      <Tabs defaultValue="slow-moving">
        <TabsList className="mb-6 gap-2 bg-transparent p-0 flex flex-wrap">
          <TabsTrigger
            value="slow-moving"
            className="rounded-lg px-5 py-2 text-sm font-semibold border data-[state=active]:bg-gray-400 data-[state=active]:text-white data-[state=active]:border-gray-400 border-gray-300 text-gray-600 bg-white"
          >
            الراكد
          </TabsTrigger>
          <TabsTrigger
            value="expired"
            className="rounded-lg px-5 py-2 text-sm font-semibold border data-[state=active]:bg-gray-900 data-[state=active]:text-white data-[state=active]:border-gray-900 border-gray-300 text-gray-600 bg-white"
          >
            أكسبير (منتهي)
          </TabsTrigger>
          <TabsTrigger
            value="reorder"
            className="rounded-lg px-5 py-2 text-sm font-semibold border data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:border-orange-500 border-gray-300 text-gray-600 bg-white"
          >
            حدود الطلب 🔔
          </TabsTrigger>
        </TabsList>
        <TabsContent value="slow-moving">
          <SlowMovingTab />
        </TabsContent>
        <TabsContent value="expired">
          <ExpiredItemsTab />
        </TabsContent>
        <TabsContent value="reorder">
          <ReorderPointsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}