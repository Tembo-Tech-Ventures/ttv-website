/**
 * enable-admin/page
 * -----------------
 * Utility endpoint that elevates the current user to an admin role during
 * development. In production builds the page simply returns `null` so the
 * build can proceed without a database connection or side effects.
 */

import { enableAdmin } from "@/modules/roles/lib/enable-admin/enable-admin";

export const dynamic = "force-dynamic";

export default async function EnableAdminPage() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  await enableAdmin();
  return "Success.";
}
