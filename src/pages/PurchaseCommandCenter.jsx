import PurchaseCycleBudgetGuard from '@/components/purchases/PurchaseCycleBudgetGuard';
import SmartPurchaseUnifiedCenter from './SmartPurchaseUnifiedCenter';

export default function PurchaseCommandCenter() {
  return <div dir="rtl" className="space-y-4">
    <PurchaseCycleBudgetGuard />
    <SmartPurchaseUnifiedCenter />
  </div>;
}
