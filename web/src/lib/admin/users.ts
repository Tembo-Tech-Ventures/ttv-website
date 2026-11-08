/*
 * The admin's people pages (/admin/users and each person's page): how a role
 * and a change to admin access read. Role names are stored in capitals
 * ("ADMIN"); the pages say them as words, the way the rest of the platform does.
 */

export const USERS_PATH = "/admin/users";

/** A stored role as the page says it: "ADMIN" is "Admin", "EDUCATOR" is "Educator". */
export function roleLabel(name: string): string {
  const words = name.trim().replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a change to someone's admin access says afterwards, in words rather than the stored "ADMIN". */
export function adminRoleNotice(action: "add-admin" | "remove-admin", changed: boolean): string {
  if (!changed) return "Admin access was already up to date.";
  return action === "add-admin" ? "Admin access was given." : "Admin access was removed.";
}
