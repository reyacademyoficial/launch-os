"use client";

import { useParams, useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
}

export function ProjectSwitcher({ projects }: { readonly projects: readonly Project[] }) {
  const router = useRouter();
  const params = useParams<{ projectId?: string | string[] }>();
  const activeId =
    typeof params.projectId === "string" ? params.projectId : undefined;

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
