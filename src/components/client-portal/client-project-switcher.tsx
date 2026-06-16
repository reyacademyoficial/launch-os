"use client";

import { useParams, usePathname, useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
}

/**
 * Switcher de proyectos para el portal del cliente. Diff vs el del equipo:
 *   - Navega a `/portal/proyectos/${id}` (no `/proyectos/${id}`).
 *   - HIDDEN_PREFIXES cubre `/portal/calculadora` y `/portal/configuracion`
 *     (no atadas a un proyecto).
 */
const HIDDEN_PREFIXES = ["/portal/calculadora", "/portal/configuracion"] as const;

function isHidden(pathname: string): boolean {
  return HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function ClientProjectSwitcher({
  projects,
}: {
  readonly projects: readonly Project[];
}) {
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
          if (value) router.push(`/portal/proyectos/${value}`);
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
