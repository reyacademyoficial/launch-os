import type { SessionProfile } from "@/lib/supabase/auth";
import type { Theme } from "@/lib/theme";

import { MobileSidebar } from "../dashboard/mobile-sidebar";
import { ShellProvider } from "../dashboard/shell-context";

import { KgSidebar } from "./sidebar";
import { KgTopbar } from "./topbar";

/**
 * KingrowShell — chasis de la plataforma para roles no-cliente.
 *
 * Reutiliza ShellProvider + MobileSidebar de LaunchOS para el patrón mobile
 * (hamburger + slide-in). La sidebar visible en desktop es la KG por capas;
 * la topbar es la KG con "Capa X · Módulo" + toggle de tema.
 *
 * Cliente NO llega acá — el gate de (app)/layout.tsx lo salta a /portal.
 */
export function KingrowShell({
  profile,
  theme,
  children,
}: {
  readonly profile: SessionProfile;
  readonly theme: Theme;
  readonly children: React.ReactNode;
}) {
  return (
    <ShellProvider>
      <div
        className="flex h-dvh overflow-hidden"
        style={{ background: "var(--kg-bg-base)", color: "var(--kg-text-1)" }}
      >
        <MobileSidebar>
          <KgSidebar profile={profile} />
        </MobileSidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <KgTopbar theme={theme} />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
            <div className="mx-auto w-full max-w-[1360px]">{children}</div>
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
