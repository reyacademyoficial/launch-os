import { setTheme } from "@/app/theme-actions";
import type { Theme } from "@/lib/theme";

import { IconMoon, IconSun } from "./icons";

/**
 * KG · Toggle de tema, segmented control (sol/luna). Reusa la Server Action
 * `setTheme` de LaunchOS — no reimplementamos cookie/persistencia. El "system"
 * queda accesible desde el user-menu de LaunchOS; acá exponemos solo los dos
 * explícitos (que es lo que el artefacto muestra).
 */
export function KgThemeToggle({ theme }: { readonly theme: Theme }) {
  const active: "light" | "dark" = theme === "light" ? "light" : "dark";
  return (
    <div
      className="flex rounded-[10px] border p-0.5"
      style={{
        background: "var(--kg-surface-2-solid)",
        borderColor: "var(--kg-border-default)",
      }}
      role="group"
      aria-label="Tema"
    >
      <ThemeButton mode="light" active={active === "light"}>
        <IconSun size={14} />
      </ThemeButton>
      <ThemeButton mode="dark" active={active === "dark"}>
        <IconMoon size={14} />
      </ThemeButton>
    </div>
  );
}

function ThemeButton({
  mode,
  active,
  children,
}: {
  readonly mode: "light" | "dark";
  readonly active: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <form action={setTheme}>
      <input type="hidden" name="theme" value={mode} />
      <button
        type="submit"
        aria-pressed={active}
        aria-label={mode === "light" ? "Tema claro" : "Tema oscuro"}
        className="kg-focus flex items-center justify-center rounded-lg px-2 py-1 transition-colors"
        style={{
          background: active ? "var(--kg-accent-halo)" : "transparent",
          color: active ? "var(--kg-accent-text)" : "var(--kg-text-3)",
        }}
      >
        {children}
      </button>
    </form>
  );
}
