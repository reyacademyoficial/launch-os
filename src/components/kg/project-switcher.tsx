"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { CSSProperties } from "react";

import { IconLaunch } from "./icons";

/**
 * KG · Switcher de proyecto.
 *
 * Port del viejo `dashboard/project-switcher.tsx` a los tokens `--kg-*`. Vive
 * en la fila del module nav (no en la topbar KG, que es compartida por todos
 * los módulos y en mobile ya está llena con hamburger + bell + tema).
 *
 * Mobile: ocupa el ancho completo en su propia línea. Desktop: pill compacta
 * a la izquierda de las tabs.
 *
 * Con un solo proyecto no hay nada que switchear — se degrada a una pill
 * estática que igual sirve de contexto ("en qué proyecto estoy").
 */

export interface ProjectSwitcherItem {
  readonly id: string;
  readonly name: string;
}

const PILL: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  padding: "6px 12px",
  borderRadius: "var(--kg-r-full)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
};

export function KgProjectSwitcher({
  projects,
  activeId,
  activeName,
}: {
  readonly projects: readonly ProjectSwitcherItem[];
  readonly activeId: string;
  readonly activeName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // El proyecto activo tiene que estar SIEMPRE entre las opciones: un
  // superadmin puede entrar a un proyecto donde no es miembro y
  // `listAccessibleProjects()` (RLS-scoped) no lo devuelve. Sin este merge el
  // <select> mostraría el nombre de otro proyecto.
  const options = projects.some((p) => p.id === activeId)
    ? projects
    : [{ id: activeId, name: activeName }, ...projects];

  if (options.length <= 1) {
    return (
      <div className="w-full md:w-auto md:max-w-[240px]" style={PILL}>
        <span style={{ color: "var(--kg-text-3)", display: "flex" }}>
          <IconLaunch size={14} />
        </span>
        <span
          className="truncate"
          style={{ fontSize: 12.5, fontWeight: 700 }}
          title={activeName}
        >
          {activeName}
        </span>
      </div>
    );
  }

  return (
    <div
      className="w-full md:w-auto md:max-w-[260px]"
      style={{ ...PILL, position: "relative", opacity: pending ? 0.6 : 1 }}
    >
      <span style={{ color: "var(--kg-text-3)", display: "flex" }}>
        <IconLaunch size={14} />
      </span>
      <select
        aria-label="Cambiar de proyecto"
        value={activeId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          if (next && next !== activeId) {
            startTransition(() => router.push(`/proyectos/${next}`));
          }
        }}
        className="kg-focus min-w-0 flex-1 truncate"
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--kg-text-1)",
          fontSize: 12.5,
          fontWeight: 700,
          paddingRight: 16,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 12,
          pointerEvents: "none",
          fontSize: 10,
          color: "var(--kg-text-3)",
        }}
      >
        ▾
      </span>
    </div>
  );
}
