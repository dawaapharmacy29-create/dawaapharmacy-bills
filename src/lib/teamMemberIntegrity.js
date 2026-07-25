import { normalizeText } from "@/lib/dataIntegrity";

export const TEAM_BRANCHES = ["دواء شكري", "دواء الشامي"];
export const EMPLOYMENT_STATUSES = ["نشط", "إجازة", "موقوف مؤقتًا", "ترك العمل", "مؤرشف"];

export const TEAM_REFERENCE_SOURCES = [
  { entity: "CustomerOrder", field: "assigned_employee", label: "طلبات العملاء" },
  { entity: "PharmacyOrder", field: "assigned_employee", label: "طلبات الصيدليات" },
  { entity: "Return", field: "employee_name", label: "المرتجعات" },
  { entity: "Expense", field: "team_member_name", label: "المصروفات" },
  { entity: "ShiftDelivery", field: "submitted_by", label: "تسليمات الشيفت" },
  { entity: "InventoryCountTask", field: "assigned_employee", label: "مهام الجرد" },
];

export function canonicalMemberPayload(form) {
  const branches = TEAM_BRANCHES.filter((branch) => (form.branches || []).includes(branch));
  const primaryBranch = branches.includes(form.primary_branch) ? form.primary_branch : (branches[0] || "");
  return {
    ...form,
    name: String(form.name || "").trim(),
    role: String(form.role || "").trim(),
    phone: String(form.phone || "").trim(),
    branches,
    primary_branch: primaryBranch,
    employment_status: form.employment_status || "نشط",
    is_active: (form.employment_status || "نشط") === "نشط",
  };
}

export function duplicateMemberGroups(members = []) {
  const groups = new Map();
  members.forEach((member) => {
    const key = normalizeText(member.name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(member);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

export function isActiveMember(member) {
  return member?.is_active !== false && !["ترك العمل", "مؤرشف", "موقوف مؤقتًا"].includes(member?.employment_status);
}
