"use client";

import { useShell } from "./shell-context";

/**
 * Hamburger toggle visible only below the `md` breakpoint. On desktop the
 * sidebar is always rendered, so the button is hidden.
 */
export function SidebarToggle() {
  const { openSidebar } = useShell();

  return (
    <button
      type="button"
      onClick={openSidebar}
      aria-label="Abrir menú"
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg md:hidden"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  );
}
