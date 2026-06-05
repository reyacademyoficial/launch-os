import type { SessionProfile } from "@/lib/supabase/auth";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function Shell({
  profile,
  children,
}: {
  readonly profile: SessionProfile;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar profile={profile} />
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
