"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

type Props = {
  readonly children: React.ReactNode;
  readonly exact?: boolean;
} & (
  | { readonly href: string; readonly scopedSuffix?: never }
  | { readonly href?: never; readonly scopedSuffix: string }
);

/**
 * Sidebar nav link.
 *
 * Two modes:
 *   - Static (`href` prop): for free routes (`/calculadora`, `/configuracion`)
 *     and admin routes (`/admin/proyectos`, `/admin/usuarios`).
 *   - Scoped to the active project (`scopedSuffix` prop): builds href from
 *     `useParams().projectId`. If no active project (e.g., on `/calculadora`),
 *     the link points to `/` (project picker).
 *
 * `exact` toggles strict pathname equality for active highlight, used for the
 * overview route (`/proyectos/[id]`) so it doesn't stay active while inside
 * `/proyectos/[id]/launches`.
 */
export function NavLink(props: Props) {
  const { children, exact } = props;
  const pathname = usePathname();
  const params = useParams<{ projectId?: string | string[] }>();
  const activeProjectId =
    typeof params.projectId === "string" ? params.projectId : undefined;

  const resolvedHref =
    "scopedSuffix" in props && props.scopedSuffix !== undefined
      ? activeProjectId
        ? `/proyectos/${activeProjectId}${props.scopedSuffix}`
        : "/"
      : props.href;

  const isActive = exact
    ? pathname === resolvedHref
    : pathname === resolvedHref ||
      (resolvedHref !== "/" && pathname.startsWith(`${resolvedHref}/`));

  return (
    <Link
      href={resolvedHref}
      className={
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors " +
        (isActive
          ? "bg-accent/15 text-accent"
          : "text-fg-muted hover:bg-surface hover:text-fg")
      }
      aria-current={isActive ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
