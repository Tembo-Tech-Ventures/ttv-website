import { enableAdmin } from "@/modules/roles/lib/enable-admin/enable-admin";

export default async function EnableAdminPage() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("This page is only available in development mode.");
  }
  await enableAdmin();
  return "Success.";
}
