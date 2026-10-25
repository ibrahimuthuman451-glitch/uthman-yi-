import "server-only";

import { redirect } from "next/navigation";
import { getCurrentUser, type AdminUser } from "@/lib/auth/session";
import type { Role } from "@prisma/client";

/** Role hierarchy: ADMIN can do everything STAFF can, plus user management. */
const roleRank: Record<Role, number> = {
  STAFF: 1,
  ADMIN: 2,
};

export function hasRole(user: AdminUser, required: Role): boolean {
  return roleRank[user.role] >= roleRank[required];
}

/** Requires any authenticated staff member; redirects to the login page. */
export async function requireStaff(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  return user;
}

/** Requires the ADMIN role; staff members are sent to the dashboard. */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await requireStaff();
  if (!hasRole(user, "ADMIN")) redirect("/admin?error=forbidden");
  return user;
}

/**
 * For server actions: returns the user or throws. Used together with
 * `safeAction` so a forged request never mutates data.
 */
export async function requireStaffForAction(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireAdminForAction(): Promise<AdminUser> {
  const user = await requireStaffForAction();
  if (!hasRole(user, "ADMIN")) throw new Error("FORBIDDEN");
  return user;
}
