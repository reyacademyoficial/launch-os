"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  readonly children: React.ReactNode;
  readonly exact?: boolean;
} & (
  | { readonly href: string; readonly scopedSuffix?: never }
  | { readonly href?: never; readonly scopedSuffix: string }
);

const PORTAL_PROJECT_PATH = /^\/portal\/proyectos\/([^/]+)/;

/**
 * NavLink para el shell del cliente. Idéntica lógica a la versión del equipo
 * pero scope-friendly al árbol `/portal/proyectos/[id]/…` en vez de
 * `/proyectos/[id]/…`. Mantener dos archivos en lugar de parametrizar evita
 * que un cambio futuro en el shell del equipo arrastre al portal del cliente.
 */
export function ClientNavLink(props: Props) {
  const { children, exact } = props;
  const pathname = usePathname();
  const activeProjectId = pathname.match(PORTAL_PROJECT_PATH)?.[1];

  const isScoped = "scopedSuffix" in props && props.scopedSuffix !== undefined;
  const scopedFallback = !isScoped ? false : !activeProjectId;

  const resolvedHref = isScoped
    ? activeProjectId
      ? `/portal/proyectos/${activeProjectId}${props.scopedSuffix}`
      : "/portal"
    : props.href;

  const isActive = scopedFallback
    ? false
    : exact
      ? pathname === resolvedHref
      : pathname === resolvedHref ||
        (resolvedHref !== "/portal" && pathname.startsWith(`${resolvedHref}/`));

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
