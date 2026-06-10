"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * Sidebar nav group con sub-ítems colapsables.
 *
 * Estado:
 *   - Al mount arranca abierto si la URL inicial matchea uno de los
 *     `scopedSuffixes` (entrás directo a /leads → "Ventas" expandido).
 *   - Después es 100% controlado por el toggle del usuario. El sidebar
 *     persiste durante la navegación SPA, así que el estado se mantiene
 *     entre clicks.
 *   - No persiste entre recargas. Uso ocasional, no merece localStorage.
 *
 * El header NO es un link — es un toggle. No hay página "Ventas" madre.
 */
export function NavGroup({
  label,
  scopedSuffixes,
  children,
}: {
  readonly label: string;
  readonly scopedSuffixes: ReadonlyArray<string>;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isInside = scopedSuffixes.some((suffix) =>
    matchesScopedSuffix(pathname, suffix),
  );
  const [open, setOpen] = useState(isInside);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors " +
          (isInside
            ? "text-fg"
            : "text-fg-muted hover:bg-surface hover:text-fg")
        }
      >
        <span>{label}</span>
        <span
          aria-hidden
          className={
            "ml-2 inline-block text-xs transition-transform " +
            (open ? "rotate-90" : "")
          }
        >
          ▸
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 border-l border-border pl-3">
          {children}
        </div>
      )}
    </div>
  );
}

function matchesScopedSuffix(pathname: string, scopedSuffix: string): boolean {
  // Igual lógica que NavLink: matchea /proyectos/<id><suffix> exacto o como
  // prefijo de un sub-segmento.
  const m = pathname.match(/^\/proyectos\/[^/]+(.*)$/);
  if (!m) return false;
  const tail = m[1] ?? "";
  return tail === scopedSuffix || tail.startsWith(`${scopedSuffix}/`);
}
