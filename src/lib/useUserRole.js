import { useAuth } from '@/lib/AuthContext';

export function useUserRole() {
  const { user } = useAuth();
  const role = user?.role || 'viewer';
  const isAdmin = role === 'admin';
  const isManager = isAdmin || role === 'manager';
  const isViewer = role === 'viewer';

  return {
    role,
    isAdmin,
    isManager,
    isViewer,
    user,
    canDeleteInvoice: isAdmin || !!user?.can_delete_invoice,
    canSaveInvoice: isManager || !!user?.can_save_invoice,
    canManageTeam: isAdmin || !!user?.can_manage_team,
    canSetBudget: isAdmin || !!user?.can_set_budget,
  };
}
