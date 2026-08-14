import PurchaseCycleBudgetGuard from '@/components/purchases/PurchaseCycleBudgetGuard';
import InventoryCapitalCommandCenter from '@/components/purchases/InventoryCapitalCommandCenter';
import InventoryIntelligenceImport from '@/components/purchases/InventoryIntelligenceImport';
import SmartClearanceEngine from '@/components/purchases/SmartClearanceEngine';
import ClearanceOutcomeTracker from '@/components/purchases/ClearanceOutcomeTracker';
import SmartPurchaseUnifiedCenter from './SmartPurchaseUnifiedCenter';

export default function PurchaseCommandCenter() {
  return <div dir="rtl" className="space-y-4">
    <PurchaseCycleBudgetGuard />
    <InventoryIntelligenceImport />
    <InventoryCapitalCommandCenter />
    <SmartClearanceEngine />
    <ClearanceOutcomeTracker />
    <SmartPurchaseUnifiedCenter />
  </div>;
}
