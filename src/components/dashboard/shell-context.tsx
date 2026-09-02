"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { writeSidebarCookie } from "@/lib/sidebar";

interface ShellContextValue {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  /** Sidebar plegada en desktop (>= md). Independiente de `sidebarOpen`. */
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Holds sidebar state for the app shell. Wraps the whole shell so the
 * toggles (in topbar) and the sidebar itself can coordinate without
 * prop-drilling across server/client boundaries.
 *
 * Dos estados distintos, a propósito:
 *   - `sidebarOpen`: overlay slide-in de mobile. Cerrado por default; en
 *     desktop no importa porque la sidebar se renderiza igual vía `md:`.
 *   - `sidebarCollapsed`: la sidebar plegada en DESKTOP, para que la página
 *     use todo el ancho. Se persiste en cookie (`initialCollapsed` llega
 *     desde el server) así el SSR ya pinta el layout correcto y no hay flash
 *     de 236px que se van al hidratar.
 */
export function ShellProvider({
  initialCollapsed = false,
  children,
}: {
  readonly initialCollapsed?: boolean;
  readonly children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialCollapsed);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCookie(next);
      return next;
    });
  }, []);

  // ⌘B / Ctrl+B — atajo estándar para plegar paneles laterales. Se ignora
  // mientras el foco está en un input/textarea/contenteditable para no
  // robarle el "bold" a un editor de texto.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "b" && e.key !== "B") return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      e.preventDefault();
      toggleSidebarCollapsed();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [toggleSidebarCollapsed]);

  return (
    <ShellContext.Provider
      value={{
        sidebarOpen,
        openSidebar,
        closeSidebar,
        sidebarCollapsed,
        toggleSidebarCollapsed,
      }}
    >
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
