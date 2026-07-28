"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

type IconProps = Readonly<{ size?: number; className?: string }>;

/**
 * KG · Sidebar nav item.
 *
 * Regla de "activo": prefijo, excepto para la home ("/") que exige match
 * exacto — sino Ejecutivo quedaría activo dentro de cualquier subruta.
 */
export function KgNavItem({
  href,
  label,
  icon: Icon,
  onNavigate,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<IconProps>;
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
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
        <Icon size={18} />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
