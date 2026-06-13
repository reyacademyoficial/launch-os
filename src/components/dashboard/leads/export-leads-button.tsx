"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Botón "Exportar" del header de leads.
 *
 * Es client-component porque necesita leer los filtros activos de la URL
 * (`useSearchParams`) y reenviarlos al route handler `/api/.../leads/export`.
 * Los filtros + el search + el sort viajan tal cual — la misma URL state que
 * `LeadsPage` lee para `listLeadsPaginated`.
 *
 * UI: un trigger "Exportar ▾" con dos opciones (xlsx y CSV). Se abre con click,
 * se cierra con click afuera o Esc, navegación con teclado básica.
 *
 * Permisos: el server hace el gate (`requireCanEditLaunchesIn`). En el client
 * el botón se monta sólo cuando el caller (page.tsx) ya validó `canEdit`.
 */
export function ExportLeadsButton({ projectId }: { readonly projectId: string }) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // El filtro de paginación (`page`) no debe propagarse al export — exportamos
  // TODOS los matches, no la página actual. Mantenemos el resto tal cual.
  const exportQuery = (() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("page");
    sp.delete("view"); // tab tabla/kanban no aplica al export (siempre tabla)
    return sp.toString();
  })();

  const xlsxHref = `/api/proyectos/${projectId}/leads/export${exportQuery ? `?${exportQuery}` : ""}`;
  const csvHref = `/api/proyectos/${projectId}/leads/export?${
    exportQuery ? `${exportQuery}&format=csv` : "format=csv"
  }`;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
      >
        ⬇ Exportar
        <span className="text-fg-subtle">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-bg-elevated p-1 shadow-lg"
        >
          <a
            href={xlsxHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded px-3 py-2 text-sm text-fg hover:bg-surface"
          >
            <span className="font-medium">Excel (.xlsx)</span>
            <span className="ml-1 text-xs text-fg-subtle">
              respeta filtros
            </span>
          </a>
          <a
            href={csvHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded px-3 py-2 text-sm text-fg hover:bg-surface"
          >
            <span className="font-medium">CSV (.csv)</span>
            <span className="ml-1 text-xs text-fg-subtle">
              respeta filtros
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
