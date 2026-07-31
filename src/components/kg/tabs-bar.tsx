"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * KG · TabsBar. Barra de pestañas ligera para navegación intra-módulo.
 *
 * Cliente porque necesita `usePathname` para marcar la activa. Sin fetch,
 * sin estado de datos — es puramente presentacional + un `matcher`.
 *
 * Colocación: debajo del ContextBar de la página. NO es sticky por default
 * (el ContextBar sí lo es). Si en algún caso hace falta que quede pegada
 * al scroll también, se agrega el offset del ContextBar arriba del top.
 * Hoy con 8 pestañas no aporta.
 */

export interface TabItem {
  readonly href: string;
  readonly label: string;
}

export function KgTabsBar({ items }: { readonly items: readonly TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Pestañas del módulo"
      style={{
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        padding: 6,
        borderRadius: "var(--kg-r-full)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        alignSelf: "flex-start",
      }}
      role="tablist"
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
              padding: "6px 14px",
              borderRadius: 999,
              background: active ? "var(--kg-accent-500)" : "transparent",
              color: active ? "#fff" : "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              transition: "all var(--kg-dur) var(--kg-ease)",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Matching por prefijo con desempate por longitud — así "/financiero/facturas"
 * no matchea también "/financiero" (que es el índice del módulo). El item más
 * específico gana.
 */
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
