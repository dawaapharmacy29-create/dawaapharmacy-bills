import PurchaseCycleBudgetGuard from '@/components/purchases/PurchaseCycleBudgetGuard';
import InventoryCapitalCommandCenter from '@/components/purchases/InventoryCapitalCommandCenter';
import SmartPurchaseUnifiedCenter from './SmartPurchaseUnifiedCenter';

export default function PurchaseCommandCenter() {
  return <div dir="rtl" className="space-y-4">
    <PurchaseCycleBudgetGuard />
    <InventoryCapitalCommandCenter />
    <SmartPurchaseUnifiedCenter />
  </div>;
}
