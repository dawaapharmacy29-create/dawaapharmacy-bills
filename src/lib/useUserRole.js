import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export function useUserRole() {
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
  });

  const role = user?.role || "viewer";
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "manager";
  const isViewer = role === "viewer";

  const canDeleteInvoice = isAdmin || !!user?.can_delete_invoice;
  const canSaveInvoice = isAdmin || role === "manager" || !!user?.can_save_invoice;
  const canManageTeam = isAdmin || !!user?.can_manage_team;
  const canSetBudget = isAdmin || !!user?.can_set_budget;

  return { role, isAdmin, isManager, isViewer, user, canDeleteInvoice, canSaveInvoice, canManageTeam, canSetBudget };
}