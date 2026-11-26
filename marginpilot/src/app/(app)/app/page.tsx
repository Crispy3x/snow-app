import { getAppContext } from "@/lib/auth";
import { PageHeader } from "@/components/ui/app";

// Placeholder: replaced by the dashboard (Phase 4).
export default async function DashboardPage() {
  const ctx = await getAppContext();
  return <PageHeader title="Dashboard" description={`Signed in as ${ctx.user.email}`} />;
}
