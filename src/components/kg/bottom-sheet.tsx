"use client";

import { useEffect, type ReactNode } from "react";

/**
 * KG · Bottom sheet. Panel deslizable desde abajo — mobile-only (className
 * `md:hidden`). Se usa como contenedor del menú de página en la shell KG.
 *
 * Esc y click en el backdrop cierran. `maxHeight: 85dvh` para que quede una
 * pestaña del contenido visible detrás — señal de que es overlay temporal.
 * Padding inferior respeta la safe area de iOS.
 *
 * z-index alto (2000) para pasar por encima de ContextBar sticky (z-20),
 * el drawer mobile del sidebar (z-40) y la sombra del scroll. Mismo nivel
 * que el `Drawer` lateral — no coexisten en pantalla.
 */
export function KgBottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ariaLabel: string;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      // display/alignItems por className — un `display: flex` inline pisaría
      // a `md:hidden` (inline > class en especificidad) y el sheet quedaría
      // visible en desktop cuando conviva con otro overlay.
      className="md:hidden flex items-end"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="kg-glass-3"
        style={{
          width: "100%",
          maxHeight: "85dvh",
          borderTopLeftRadius: "var(--kg-r-20)",
          borderTopRightRadius: "var(--kg-r-20)",
          borderTop: "1px solid var(--kg-border-default)",
          boxShadow: "var(--kg-shadow-float)",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "env(safe-area-inset-bottom)",
          animation: "kg-sheet-up var(--kg-dur-slow) var(--kg-ease)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 4,
          }}
        >
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: "var(--kg-border-default)",
            }}
          />
        </div>
        <div
          style={{
            overflowY: "auto",
            padding: "12px 20px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
