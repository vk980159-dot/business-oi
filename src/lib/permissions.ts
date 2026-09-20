import { AppError } from "./errors";

export type Role = "user" | "support" | "admin";
export type Permission =
  | "admin.access"
  | "business.moderate"
  | "business.verify"
  | "payments.view"
  | "payments.refund"
  | "users.manage"
  | "settings.manage"
  | "catalog.manage"
  | "audit.view"
  | "reports.view";

/** Server-side RBAC matrix. Support staff can moderate and look; only admins can move money or change rules. */
const MATRIX: Record<Role, Permission[]> = {
  user: [],
  support: ["admin.access", "business.moderate", "payments.view", "audit.view"],
  admin: [
    "admin.access", "business.moderate", "business.verify", "payments.view", "payments.refund",
    "users.manage", "settings.manage", "catalog.manage", "audit.view", "reports.view",
  ],
};

export const can = (role: Role, p: Permission) => MATRIX[role]?.includes(p) ?? false;

export function assertCan(role: Role, p: Permission) {
  if (!can(role, p)) throw new AppError("forbidden", "You do not have permission to do that.");
}
