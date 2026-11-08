/*
 * The admin's people pages (/admin/users and each person's page): how a role
 * reads. Role names are stored in capitals
 * ("ADMIN"); the pages say them as words, the way the rest of the platform does.
 */

export const USERS_PATH = "/admin/users";

/** A stored role as the page says it: "ADMIN" is "Admin", "EDUCATOR" is "Educator". */
export function roleLabel(name: string): string {
  const words = name.trim().replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
