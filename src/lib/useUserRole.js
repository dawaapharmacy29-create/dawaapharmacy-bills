import { useAuth } from '@/lib/AuthContext';

export function useUserRole() {
  const { user } = useAuth();
  const rawRole = user?.original_role || user?.role || 'viewer';
  const role = rawRole === 'admin' ? 'general_manager' : rawRole;

  const isAdmin = role === 'general_manager';
  const isBranchManager = role === 'branch_manager';
  const isInvoiceEntry = ['invoice_entry', 'purchasing', 'purchases'].includes(role);
  const isInvoiceReviewer = ['invoice_reviewer', 'reviewer'].includes(role);
  const isAccountant = role === 'accountant';
  const isViewer = role === 'viewer';
  const isManager = isAdmin || isBranchManager;

  const canEnterInvoice = isAdmin || isBranchManager || isInvoiceEntry;
  const canReviewInvoice = isAdmin || isBranchManager || isInvoiceReviewer;
  const canApproveInvoice = isAdmin || isAccountant;

  return {
    role,
    isAdmin,
    isManager,
    isBranchManager,
    isInvoiceEntry,
    isInvoiceReviewer,
    isAccountant,
    isViewer,
    user,
    canEnterInvoice,
    canReviewInvoice,
    canApproveInvoice,
    canDeleteInvoice: isAdmin,
    canSaveInvoice: canEnterInvoice,
    canManageTeam: isAdmin || isBranchManager,
    canSetBudget: isAdmin || isAccountant,
  };
}
