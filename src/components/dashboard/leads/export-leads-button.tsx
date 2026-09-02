"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { secondaryBtn } from "@/components/kg/form-primitives";

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
 *
 * Migración KG: sólo cambió la piel (tokens viejos `bg-surface`/`text-fg` →
 * `secondaryBtn` + vars `--kg-*`). La construcción de los hrefs y el manejo
 * de foco/Esc quedaron intactos: son la lógica que respeta los filtros.
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
        className="kg-focus"
        style={{
          ...secondaryBtn,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          minHeight: 36,
          whiteSpace: "nowrap",
        }}
      >
        ⬇ Exportar
        <span aria-hidden style={{ color: "var(--kg-text-3)" }}>
          ▾
        </span>
      </button>

      {open && (
        // zIndex 900: por encima del contenido pero debajo de Drawer /
        // BottomSheet (2000), igual que la barra de selección de KG.
        <div
          role="menu"
          className="kg-glass-3"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 900,
            width: 232,
            padding: 4,
            borderRadius: "var(--kg-r-12)",
            border: "1px solid var(--kg-border-default)",
            boxShadow: "var(--kg-shadow-float)",
          }}
        >
          <ExportOption
            href={xlsxHref}
            label="Excel (.xlsx)"
            onNavigate={() => setOpen(false)}
          />
          <ExportOption
            href={csvHref}
            label="CSV (.csv)"
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Ítem del menú. Sigue siendo un `<a href>` plano (no un Link de Next): el
 * destino es un route handler que devuelve un archivo, no una página — el
 * router de Next no debe interceptarlo.
 */
function ExportOption({
  href,
  label,
  onNavigate,
}: {
  readonly href: string;
  readonly label: string;
  readonly onNavigate: () => void;
}) {
  return (
    <a
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="kg-focus"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 36,
        justifyContent: "center",
        padding: "7px 10px",
        borderRadius: "var(--kg-r-8)",
        textDecoration: "none",
        color: "var(--kg-text-1)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        respeta filtros
      </span>
    </a>
  );
}
