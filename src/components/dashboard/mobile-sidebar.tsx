"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useShell } from "./shell-context";

/**
 * Mobile-aware sidebar wrapper. Desktop (`md` and up): always visible, full
 * height. Mobile: slides in from the left over a backdrop on toggle, Esc or
 * backdrop-click closes it, route change closes it too.
 *
 * The wrapper itself is a flex container so the inner Sidebar (block-level
 * `<aside>` with no explicit height) stretches to the wrapper's full height
 * instead of collapsing to content height.
 */
export function MobileSidebar({ children }: { readonly children: ReactNode }) {
  const { sidebarOpen, closeSidebar } = useShell();
  const pathname = usePathname();

  useEffect(() => {
    if (!sidebarOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSidebar();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [sidebarOpen, closeSidebar]);

  // Close on navigation so users don't have to dismiss it manually after
  // clicking a nav link on mobile.
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  return (
    <>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={closeSidebar}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}
      <div
        className={
          "fixed inset-y-0 left-0 z-40 flex transform transition-transform duration-200 md:static md:translate-x-0 " +
          (sidebarOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        {children}
      </div>
    </>
  );
}
