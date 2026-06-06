"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { setTheme } from "@/app/theme-actions";
import { signOut } from "@/lib/auth/actions";
import type { SessionProfile } from "@/lib/supabase/auth";
import { type Theme, THEMES } from "@/lib/theme";

export function UserMenu({
  profile,
  theme,
}: {
  readonly profile: SessionProfile;
  readonly theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside the menu.
  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const label = profile.fullName ?? profile.email ?? profile.id;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de usuario"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <PersonIcon />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-full z-40 mt-2 min-w-[220px] overflow-hidden rounded-md border border-border bg-bg-elevated shadow-card"
        >
          <div className="border-b border-border px-3 py-3">
            <div className="truncate text-sm font-medium text-fg">{label}</div>
            {profile.email && profile.fullName && (
              <div className="truncate text-xs text-fg-subtle">{profile.email}</div>
            )}
            <div className="mt-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              {profile.role}
            </div>
          </div>

          <Link
            href="/configuracion"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
          >
            Configuración
          </Link>

          <div className="border-t border-border px-3 py-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
              Tema
            </div>
            <div className="flex gap-1">
              {THEMES.map((t) => (
                <form key={t} action={setTheme} className="flex-1">
                  <input type="hidden" name="theme" value={t} />
                  <button
                    type="submit"
                    aria-pressed={theme === t}
                    className={
                      "w-full rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors " +
                      (theme === t
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border bg-surface text-fg-muted hover:text-fg")
                    }
                  >
                    {THEME_LABELS[t]}
                  </button>
                </form>
              ))}
            </div>
          </div>

          <form action={signOut} className="border-t border-border">
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-surface hover:text-error"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const THEME_LABELS: Record<Theme, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Oscuro",
};

function PersonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
