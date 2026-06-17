"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

/**
 * Panel de filtros compartido por las 4 vistas de analítica. Patrón
 * idéntico a `leads-table.tsx`: URL state, server-paginated/filtered.
 *
 *   - Rango de fecha sobre `date_start` (no `created_at`) — la vista
 *     pregunta "lanzamientos en este período".
 *   - Multi-select de launches via checkboxes en dropdown. Vacío =
 *     todos. El estado se serializa como CSV de uuids en `?launches`.
 *
 * Los cambios actualizan la URL via `router.replace` para que el server
 * re-fetchee. `view` (tab activo) se preserva.
 */
export function AnalyticsFilters({
  launches,
  initialDateFrom,
  initialDateTo,
  initialLaunchIds,
}: {
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly initialDateFrom: string;
  readonly initialDateTo: string;
  readonly initialLaunchIds: ReadonlyArray<string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialLaunchIds),
  );

  const selectedSummary = useMemo(() => {
    if (selected.size === 0) return "Todos los lanzamientos";
    if (selected.size === 1) {
      const id = Array.from(selected)[0];
      return launches.find((l) => l.id === id)?.name ?? "1 lanzamiento";
    }
    return `${selected.size} lanzamientos`;
  }, [selected, launches]);

  function commitLaunches(next: ReadonlySet<string>) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next.size === 0) {
      sp.delete("launches");
    } else {
      sp.set("launches", Array.from(next).join(","));
    }
    startTransition(() => router.replace(`?${sp.toString()}`, { scroll: false }));
  }

  function commitDate(key: "from" | "to", value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    startTransition(() => router.replace(`?${sp.toString()}`, { scroll: false }));
  }

  function toggleLaunch(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      commitLaunches(next);
      return next;
    });
  }

  function clearLaunches() {
    setSelected(new Set());
    commitLaunches(new Set());
  }

  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface/40 p-3 sm:grid-cols-4">
      <label className="block text-xs font-medium text-fg-subtle">
        Desde (fecha de lanzamiento)
        <input
          type="date"
          defaultValue={initialDateFrom}
          onBlur={(e) => commitDate("from", e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
        />
      </label>
      <label className="block text-xs font-medium text-fg-subtle">
        Hasta (fecha de lanzamiento)
        <input
          type="date"
          defaultValue={initialDateTo}
          onBlur={(e) => commitDate("to", e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
        />
      </label>
      <div className="relative sm:col-span-2">
        <span className="block text-xs font-medium text-fg-subtle">
          Lanzamientos
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 flex w-full items-center justify-between rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
        >
          <span>{selectedSummary}</span>
          <span className="text-fg-subtle">{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-elevated shadow-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs text-fg-subtle">
                {selected.size} de {launches.length} seleccionados
              </span>
              <button
                type="button"
                onClick={clearLaunches}
                className="text-xs text-accent hover:underline"
              >
                Limpiar
              </button>
            </div>
            {launches.length === 0 ? (
              <p className="px-3 py-3 text-xs text-fg-muted">
                No hay lanzamientos en el proyecto.
              </p>
            ) : (
              launches.map((l) => (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={(e) => toggleLaunch(l.id, e.target.checked)}
                  />
                  {l.name}
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
