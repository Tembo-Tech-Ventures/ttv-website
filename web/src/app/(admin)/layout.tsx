import { getAccess } from "@/modules/auth/lib/get-access/get-access";
import { MainAdminLayout } from "./components/main-admin-layout/main-admin-layout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAccess();
  return (
    <MainAdminLayout hasAccess={!!access.content}>{children}</MainAdminLayout>
  );
}
