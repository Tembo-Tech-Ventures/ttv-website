import { MainDashboardLayout } from "./components/main-dashboard-layout/main-dashboard-layout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainDashboardLayout>{children}</MainDashboardLayout>;
}
