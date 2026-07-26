import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import LoginPage from './pages/LoginPage';
import AppLayout from './components/layout/AppLayout';
import AppErrorBoundary from './components/system/AppErrorBoundary';
import FastDashboard from './pages/FastDashboard';
import Dashboard from './pages/Dashboard';
import FastPurchaseInvoices from './pages/FastPurchaseInvoices';
import PurchaseInvoices from './pages/PurchaseInvoices.jsx';
import QuickInvoiceEntry from './pages/QuickInvoiceEntry';
import InvoiceQualityCenter from './pages/InvoiceQualityCenter';
import DoctorAccountCoverage from './pages/DoctorAccountCoverage';
import Suppliers from './pages/Suppliers.jsx';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import SupplierBalances from './pages/SupplierBalances';
import ActivityLog from './pages/ActivityLog';
import UserManagement from './pages/UserManagement';
import TeamMembers from './pages/TeamMembers';
import PendingInvoices from './pages/PendingInvoices';
import MedicineList from './pages/MedicineList';
import Returns from './pages/Returns';
import InventoryManagement from './pages/InventoryManagement';
import CustomerOrders from './pages/CustomerOrders';
import PharmacyOrders from './pages/PharmacyOrders';
import InventoryCount from './pages/InventoryCount';
import ReportsBranch from './pages/ReportsBranch';
import SupplierBalancesBranch from './pages/SupplierBalancesBranch';
import ReplenishmentPage from './pages/ReplenishmentPage';
import ShiftDelivery from './pages/ShiftDelivery';
import SecurityAuditPage from './pages/SecurityAuditPage';
import SupplierRulesBackfill from './pages/SupplierRulesBackfill';
import ReviewNeededInvoices from './components/invoices/ReviewNeededInvoices';
import DataReviewCenter from './pages/DataReviewCenter';
import BranchSettlements from './pages/BranchSettlements';
import PurchaseWorkflowCenter from './pages/PurchaseWorkflowCenter';
import TeamMergeCenter from './pages/TeamMergeCenter';
import SystemStatus from './pages/SystemStatus';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();

  if (isLoadingAuth) {
    return (
      <div dir="rtl" className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-white">
        <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500">جاري التحقق من الحساب...</p>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<FastDashboard />} />
        <Route path="/dashboard/advanced" element={<Dashboard />} />
        <Route path="/system-status" element={<SystemStatus />} />
        <Route path="/invoices/new" element={<QuickInvoiceEntry />} />
        <Route path="/invoices/quality" element={<InvoiceQualityCenter />} />
        <Route path="/invoices/manage" element={<PurchaseInvoices />} />
        <Route path="/invoices" element={<FastPurchaseInvoices />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/supplier-balances" element={<SupplierBalances />} />
        <Route path="/activity-log" element={<ActivityLog />} />
        <Route path="/user-management" element={<UserManagement />} />
        <Route path="/doctor-account-coverage" element={<DoctorAccountCoverage />} />
        <Route path="/team-members" element={<TeamMembers />} />
        <Route path="/team-merge" element={<TeamMergeCenter />} />
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
        <Route path="/security-audit" element={<SecurityAuditPage />} />
        <Route path="/supplier-rules-backfill" element={<SupplierRulesBackfill />} />
        <Route path="/review-needed-invoices" element={<ReviewNeededInvoices />} />
        <Route path="/data-review" element={<DataReviewCenter />} />
        <Route path="/branch-settlements" element={<BranchSettlements />} />
        <Route path="/purchase-workflow" element={<PurchaseWorkflowCenter />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

export default App;