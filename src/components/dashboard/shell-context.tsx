"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface ShellContextValue {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Holds mobile sidebar open/close state for the app shell. Wraps the whole
 * shell so the hamburger toggle (in topbar) and the slide-in sidebar can
 * coordinate without prop-drilling across server/client boundaries.
 *
 * Closed by default — desktop renders the sidebar regardless via Tailwind
 * `md:` modifiers, so the closed state only matters below the md breakpoint.
 */
export function ShellProvider({ children }: { readonly children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <ShellContext.Provider value={{ sidebarOpen, openSidebar, closeSidebar }}>
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used inside <ShellProvider>");
  }
  return ctx;
}
