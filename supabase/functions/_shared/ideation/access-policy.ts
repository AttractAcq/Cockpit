const IDEATION_STAFF_ROLES = new Set(["admin", "account_manager"]);

export function isIdeationStaffRole(role: string): boolean {
  return IDEATION_STAFF_ROLES.has(role);
}
