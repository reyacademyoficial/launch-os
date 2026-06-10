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

const PROJECT_PATH = /^\/proyectos\/([^/]+)/;

/**
 * Sidebar nav link.
 *
 * Two modes:
 *   - Static (`href` prop): rutas libres (`/calculadora`, `/configuracion`) y
 *     admin (`/admin/proyectos`, `/admin/usuarios`).
 *   - Scoped (`scopedSuffix`): se arma a partir del projectId del pathname
 *     actual. ¿Por qué pathname y no useParams? Sidebar vive en
 *     `(app)/layout.tsx`, que es padre del segmento `[projectId]`. useParams
 *     puede devolver undefined durante una transición → el link cae a "/" y
 *     un click te manda al project picker en lugar del destino esperado. El
 *     pathname siempre tiene el path actual sin lag.
 *
 * `exact` fuerza igualdad estricta para el highlight del overview
 * (`/proyectos/[id]`) — sino quedaría activo dentro de `/launches`, `/leads`,
 * etc.
 *
 * Si scopedSuffix y no se pudo extraer projectId del pathname (estás en una
 * ruta no-proyecto como `/calculadora`), el link cae a "/" pero NUNCA se
 * muestra activo: evita que todos los scoped links se vean rosa en `/`.
 */
export function NavLink(props: Props) {
  const { children, exact } = props;
  const pathname = usePathname();
  const activeProjectId = pathname.match(PROJECT_PATH)?.[1];

  const isScoped = "scopedSuffix" in props && props.scopedSuffix !== undefined;
  const scopedFallback = !isScoped ? false : !activeProjectId;

  const resolvedHref = isScoped
    ? activeProjectId
      ? `/proyectos/${activeProjectId}${props.scopedSuffix}`
      : "/"
    : props.href;

  const isActive = scopedFallback
    ? false
    : exact
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
