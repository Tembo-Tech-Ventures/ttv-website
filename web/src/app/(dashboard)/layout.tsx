import { getAccess } from "@/modules/auth/lib/get-access/get-access";
import { MainDashboardLayout } from "./components/main-dashboard-layout/main-dashboard-layout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAccess();
  return (
    <MainDashboardLayout hasAccess={!!access.content}>
      {children}
    </MainDashboardLayout>
  );
}
