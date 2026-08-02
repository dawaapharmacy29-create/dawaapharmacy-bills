import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import LoginPage from './pages/LoginPage';
import AppLayout from './components/layout/AppLayout';
import AppErrorBoundary from './components/system/AppErrorBoundary';
import RoleRouteGuard from './components/auth/RoleRouteGuard';

// كل الصفحات بتتحمّل عند الحاجة فقط (lazy) بدل ما تتحمّل كلها مع أول فتح للتطبيق.
// ده بيقلل حجم التحميل الأولي جدًا (كان يتضمن كل صفحات المشتريات والتقارير ومكتبات
// التصدير Excel/PDF دفعة واحدة حتى لو المستخدم فاتح صفحة تسليم الشيفت بس).
const FastDashboard = lazy(() => import('./pages/FastDashboard'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DailyTasksCenter = lazy(() => import('./pages/DailyTasksCenter'));
const UnifiedReportsCenter = lazy(() => import('./pages/UnifiedReportsCenter'));
const UnifiedInvoiceCenter = lazy(() => import('./pages/UnifiedInvoiceCenter'));
const FastPurchaseInvoices = lazy(() => import('./pages/FastPurchaseInvoices'));
const PurchaseInvoices = lazy(() => import('./pages/PurchaseInvoices.jsx'));
const QuickInvoiceEntry = lazy(() => import('./pages/QuickInvoiceEntry'));
const InvoiceQualityCenter = lazy(() => import('./pages/InvoiceQualityCenter'));
const DoctorAccountCoverage = lazy(() => import('./pages/DoctorAccountCoverage'));
const Suppliers = lazy(() => import('./pages/Suppliers.jsx'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const SupplierBalances = lazy(() => import('./pages/SupplierBalances'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const TeamMembers = lazy(() => import('./pages/TeamMembers'));
const PendingInvoices = lazy(() => import('./pages/PendingInvoices'));
const MedicineList = lazy(() => import('./pages/MedicineList'));
const Returns = lazy(() => import('./pages/Returns'));
const InventoryManagement = lazy(() => import('./pages/InventoryManagement'));
const CustomerOrders = lazy(() => import('./pages/CustomerOrders'));
const PharmacyOrders = lazy(() => import('./pages/PharmacyOrders'));
const InventoryCount = lazy(() => import('./pages/InventoryCount'));
const ReportsBranch = lazy(() => import('./pages/ReportsBranch'));
const SupplierBalancesBranch = lazy(() => import('./pages/SupplierBalancesBranch'));
const ReplenishmentPage = lazy(() => import('./pages/ReplenishmentPage'));
const ShiftDelivery = lazy(() => import('./pages/ShiftDelivery'));
const TreasuryCenter = lazy(() => import('./pages/TreasuryCenter'));
const OperationsTreasuryCenter = lazy(() => import('./pages/OperationsTreasuryCenter'));
const ShiftTreasuryReview = lazy(() => import('./pages/ShiftTreasuryReview'));
const TreasuryOperations = lazy(() => import('./pages/TreasuryOperations'));
const PurchaseOperationsReview = lazy(() => import('./pages/PurchaseOperationsReview'));
const SecurityAuditPage = lazy(() => import('./pages/SecurityAuditPage'));
const SupplierRulesBackfill = lazy(() => import('./pages/SupplierRulesBackfill'));
const ReviewNeededInvoices = lazy(() => import('./components/invoices/ReviewNeededInvoices'));
const DataReviewCenter = lazy(() => import('./pages/DataReviewCenter'));
const BranchSettlements = lazy(() => import('./pages/BranchSettlements'));
const PurchaseWorkflowCenter = lazy(() => import('./pages/PurchaseWorkflowCenter'));
const SmartPurchaseCenter = lazy(() => import('./pages/SmartPurchaseCenter'));
const SmartPurchaseReceiving = lazy(() => import('./pages/SmartPurchaseReceiving'));
const SmartPurchaseOrderManagement = lazy(() => import('./pages/SmartPurchaseOrderManagement'));
const SmartPurchaseInsights = lazy(() => import('./pages/SmartPurchaseInsights'));
const SmartPurchaseUnifiedCenter = lazy(() => import('./pages/SmartPurchaseUnifiedCenter'));
const TeamMergeCenter = lazy(() => import('./pages/TeamMergeCenter'));
const SystemStatus = lazy(() => import('./pages/SystemStatus'));
const BranchPerformanceCenter = lazy(() => import('./pages/BranchPerformanceCenter'));
const SalesPurchasesReport = lazy(() => import('./pages/SalesPurchasesReport'));
const Base44SyncReview = lazy(() => import('./pages/Base44SyncReview'));

function PageLoading() {
  return <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
    <div className="w-9 h-9 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
    <p className="text-sm font-medium text-slate-500">جاري تحميل الصفحة...</p>
  </div>;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  if (isLoadingAuth) return <div dir="rtl" className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-white"><div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin"/><p className="text-sm font-medium text-slate-500">جاري التحقق من الحساب...</p></div>;
  if (!isAuthenticated) return <LoginPage />;
  return <Suspense fallback={<PageLoading />}><Routes><Route element={<AppLayout />}>
    <Route path="/" element={<FastDashboard />} />
    <Route path="/dashboard/advanced" element={<Dashboard />} />
    <Route path="/daily-tasks" element={<DailyTasksCenter />} />
    <Route path="/reports-center" element={<UnifiedReportsCenter />} />
    <Route path="/branch-performance" element={<BranchPerformanceCenter />} />
    <Route path="/sales-purchases-report" element={<SalesPurchasesReport />} />
    <Route path="/system-status" element={<RoleRouteGuard adminOnly><SystemStatus /></RoleRouteGuard>} />
    <Route path="/invoice-center" element={<UnifiedInvoiceCenter />} />
    <Route path="/invoices/new" element={<QuickInvoiceEntry />} />
    <Route path="/invoices/quality" element={<InvoiceQualityCenter />} />
    <Route path="/invoices/manage" element={<PurchaseInvoices />} />
    <Route path="/invoices" element={<FastPurchaseInvoices />} />
    <Route path="/suppliers" element={<Suppliers />} />
    <Route path="/expenses" element={<Expenses />} />
    <Route path="/reports" element={<Reports />} />
    <Route path="/supplier-balances" element={<SupplierBalances />} />
    <Route path="/activity-log" element={<ActivityLog />} />
    <Route path="/user-management" element={<RoleRouteGuard adminOnly><UserManagement /></RoleRouteGuard>} />
    <Route path="/doctor-account-coverage" element={<RoleRouteGuard adminOnly><DoctorAccountCoverage /></RoleRouteGuard>} />
    <Route path="/team-members" element={<TeamMembers />} />
    <Route path="/team-merge" element={<RoleRouteGuard adminOnly><TeamMergeCenter /></RoleRouteGuard>} />
    <Route path="/pending-invoices" element={<PendingInvoices />} />
    <Route path="/medicine-list" element={<MedicineList />} />
    <Route path="/returns" element={<Returns />} />
    <Route path="/inventory" element={<InventoryManagement />} />
    <Route path="/customer-orders" element={<CustomerOrders />} />
    <Route path="/pharmacy-orders" element={<PharmacyOrders />} />
    <Route path="/inventory-count" element={<InventoryCount />} />
    <Route path="/reports-branch" element={<ReportsBranch />} />
    <Route path="/supplier-balances-branch" element={<SupplierBalancesBranch />} />
    <Route path="/replenishment" element={<ReplenishmentPage />} />
    <Route path="/shift-delivery" element={<ShiftDelivery />} />
    <Route path="/treasury" element={<TreasuryCenter />} />
    <Route path="/operations-center" element={<OperationsTreasuryCenter />} />
    <Route path="/treasury/shift-review" element={<RoleRouteGuard managerOnly><ShiftTreasuryReview /></RoleRouteGuard>} />
    <Route path="/treasury-operations" element={<RoleRouteGuard adminOnly><TreasuryOperations /></RoleRouteGuard>} />
    <Route path="/purchase-operations-review" element={<RoleRouteGuard adminOnly><PurchaseOperationsReview /></RoleRouteGuard>} />
    <Route path="/security-audit" element={<RoleRouteGuard adminOnly><SecurityAuditPage /></RoleRouteGuard>} />
    <Route path="/supplier-rules-backfill" element={<RoleRouteGuard adminOnly><SupplierRulesBackfill /></RoleRouteGuard>} />
    <Route path="/review-needed-invoices" element={<ReviewNeededInvoices />} />
    <Route path="/data-review" element={<RoleRouteGuard adminOnly><DataReviewCenter /></RoleRouteGuard>} />
    <Route path="/base44-sync-review" element={<RoleRouteGuard adminOnly><Base44SyncReview /></RoleRouteGuard>} />
    <Route path="/branch-settlements" element={<RoleRouteGuard adminOnly><BranchSettlements /></RoleRouteGuard>} />
    <Route path="/purchase-workflow" element={<PurchaseWorkflowCenter />} />
    <Route path="/purchase-center" element={<SmartPurchaseUnifiedCenter />} />
    <Route path="/smart-purchase-orders" element={<SmartPurchaseCenter />} />
    <Route path="/smart-purchase-orders/manage" element={<SmartPurchaseOrderManagement />} />
    <Route path="/smart-purchase-receiving" element={<SmartPurchaseReceiving />} />
    <Route path="/smart-purchase-insights" element={<SmartPurchaseInsights />} />
  </Route><Route path="*" element={<PageNotFound />} /></Routes></Suspense>;
};

function App(){return <AppErrorBoundary><AuthProvider><QueryClientProvider client={queryClientInstance}><Router><AuthenticatedApp /></Router><Toaster /></QueryClientProvider></AuthProvider></AppErrorBoundary>}
export default App;
