"use client";

import { useParams, usePathname, useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
}

/**
 * Routes where the project switcher is suppressed because the page itself
 * isn't tied to a project context — showing it there would either confuse
 * (it'd just dangle in the header) or imply the action affects the current
 * page, which it doesn't.
 */
const HIDDEN_PREFIXES = ["/configuracion", "/admin"] as const;

function isHidden(pathname: string): boolean {
  return HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function ProjectSwitcher({ projects }: { readonly projects: readonly Project[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string | string[] }>();
  const activeId =
    typeof params.projectId === "string" ? params.projectId : undefined;

  if (isHidden(pathname)) return null;

  if (projects.length === 0) {
    return <span className="text-xs text-fg-subtle">Sin proyectos</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fg-subtle">Proyecto</span>
      <select
        value={activeId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          if (value) router.push(`/proyectos/${value}`);
        }}
        className="rounded-md border border-border bg-input px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="" disabled>
          Elegí…
        </option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
