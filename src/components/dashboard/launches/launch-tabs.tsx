"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Nav de tabs dentro del detalle del launch. Sub-rutas reales (no
 * query-param), así cada tab fetchea solo lo suyo en el server.
 *
 * `base` es la URL del layout (.../launches/<id>). Cada tab apunta a
 * `${base}/<slug>` y el activo se marca por prefix match del pathname.
 */
const TABS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "kpi", label: "KPI" },
  { slug: "cobros", label: "Cobros" },
  { slug: "presupuesto", label: "Presupuesto" },
  { slug: "consumo", label: "Consumo" },
  { slug: "calendario", label: "Calendario" },
  { slug: "integraciones", label: "Integraciones" },
  { slug: "alertas", label: "Alertas" },
  { slug: "ia", label: "IA" },
];

export function LaunchTabs({ base }: { readonly base: string }) {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Secciones del lanzamiento"
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((tab) => {
        const href = `${base}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            role="tab"
            aria-selected={active}
            className={
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors " +
              (active
                ? "border-accent text-accent"
                : "border-transparent text-fg-muted hover:border-border hover:text-fg")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
