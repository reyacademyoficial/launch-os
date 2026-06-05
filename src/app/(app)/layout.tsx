import { Shell } from "@/components/dashboard/shell";
import { requireSessionProfile } from "@/lib/supabase/auth";

/**
 * Protected layout — auth defense layer #2 + the app chrome.
 * Real navigation lives in <Shell>; this file just gates and forwards.
 */
export default async function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireSessionProfile();
  return <Shell profile={profile}>{children}</Shell>;
}
