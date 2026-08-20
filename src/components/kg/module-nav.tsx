"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { KgTabsBar, type TabItem } from "./tabs-bar";

/**
 * KG · Module nav. Reemplaza el uso directo de `KgTabsBar` en los layouts.
 *
 * Dos renders:
 *   - Desktop (`md` y arriba): `KgTabsBar` original, con `flexWrap: wrap`. Los
 *     módulos con muchas pestañas (Financiero tiene 13) se apilan en filas.
 *   - Mobile: carrusel horizontal — una sola línea de pills que se desliza
 *     con overflow-x. La clase `.kg-tabs` (globals.css) oculta la scrollbar.
 *     Los pills no colapsan (`flexShrink: 0`) y una pequeña porción del
 *     siguiente pill queda visible en el borde derecho — señal implícita de
 *     que hay más. El ancho de la página no se ve afectado: el scroll vive
 *     dentro del contenedor `<nav>`, no del body.
 */
export function KgModuleNav({ items }: { readonly items: readonly TabItem[] }) {
  return (
    <>
      <div className="hidden md:block">
        <KgTabsBar items={items} />
      </div>
      <div className="md:hidden">
        <MobileScrollTabs items={items} />
      </div>
    </>
  );
}

function MobileScrollTabs({ items }: { readonly items: readonly TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Pestañas del módulo"
      role="tablist"
      className="kg-tabs"
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        padding: "6px 4px",
        margin: "0 -4px",
      }}
    >
      {items.map((t) => {
        const active = isActive(pathname, t.href, items);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="kg-focus"
            role="tab"
            aria-selected={active}
            style={{
              flexShrink: 0,
              padding: "8px 14px",
              borderRadius: 999,
              background: active ? "var(--kg-accent-500)" : "var(--kg-surface-2-solid)",
              color: active ? "#fff" : "var(--kg-text-2)",
              border: "1px solid var(--kg-border-subtle)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "background var(--kg-dur) var(--kg-ease)",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mismo matcher que `KgTabsBar` — item más específico gana el resaltado. */
function isActive(
  pathname: string,
  href: string,
  items: readonly TabItem[],
): boolean {
  const matches = items.filter(
    (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
  );
  if (matches.length === 0) return false;
  const winner = matches.reduce((a, b) =>
    b.href.length > a.href.length ? b : a,
  );
  return winner.href === href;
}
