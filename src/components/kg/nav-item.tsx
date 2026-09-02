"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * KG · Sidebar nav item.
 *
 * Regla de "activo": prefijo, excepto para la home ("/") que exige match
 * exacto — sino Ejecutivo quedaría activo dentro de cualquier subruta.
 *
 * `matchPrefixes` suma rutas que pertenecen al módulo pero no cuelgan de su
 * `href` — hoy solo Lanzamientos, cuyo trabajo real vive en `/proyectos/…`
 * (ver `MODULE_ALIASES` en layers.ts). Sin esto el ítem queda apagado
 * mientras el usuario está dentro de un proyecto.
 *
 * `icon` viene YA renderizado (ReactNode), no como componente. Es un boundary
 * server→client: pasar componentes-como-función cruza esa frontera y Next
 * los rechaza porque no son serializables. Renderizar en el padre server y
 * pasar la JSX (que sí serializa) es la única forma limpia.
 */
export function KgNavItem({
  href,
  label,
  icon,
  matchPrefixes,
  onNavigate,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly matchPrefixes?: readonly string[];
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const matches = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  const isActive =
    (href === "/" ? pathname === "/" : matches(href)) ||
    (matchPrefixes ?? []).some(matches);

  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className="kg-hov kg-focus group flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium transition-colors"
      style={{
        color: isActive ? "var(--kg-accent-text)" : "var(--kg-text-2)",
        background: isActive ? "var(--kg-accent-halo)" : "transparent",
        boxShadow: isActive ? "inset 0 0 0 1px var(--kg-border-accent)" : undefined,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        style={{ color: isActive ? "var(--kg-accent-text)" : "var(--kg-text-3)" }}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
