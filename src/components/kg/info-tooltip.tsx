"use client";

import { useState } from "react";

/**
 * KG · InfoTooltip. Ícono ⓘ con tooltip explicativo.
 *
 * Diseño intencionalmente simple:
 *  - Aparece en hover Y focus (accesible por teclado).
 *  - `title` como fallback nativo si JS falla o si el usuario prefiere el
 *    tooltip del navegador.
 *  - Sin dependencias externas, sin portal — position:absolute anclado al
 *    ícono. Si el tooltip se corta contra el borde de una tarjeta chica,
 *    conviene reposicionarlo desde el caller (prop `align`).
 *  - Contenido es `string` — para tooltips ricos (con listas, código),
 *    refactorizar a ReactNode más adelante.
 */

export interface KgInfoTooltipProps {
  readonly content: string;
  /** Alineación del tooltip respecto al ícono. Default 'left'. */
  readonly align?: "left" | "right";
}

export function KgInfoTooltip({
  content,
  align = "left",
}: KgInfoTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`Información: ${content}`}
        title={content}
        className="kg-focus"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          fontSize: 12,
          lineHeight: 1,
          color: "var(--kg-text-3)",
          cursor: "help",
          userSelect: "none",
        }}
      >
        ⓘ
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: align === "left" ? 0 : undefined,
            right: align === "right" ? 0 : undefined,
            padding: "10px 12px",
            background: "var(--kg-surface-1-solid)",
            border: "1px solid var(--kg-border-subtle)",
            borderRadius: "var(--kg-r-8)",
            fontSize: 11.5,
            color: "var(--kg-text-2)",
            width: 280,
            maxWidth: 280,
            lineHeight: 1.5,
            boxShadow: "var(--kg-shadow-float)",
            zIndex: 100,
            whiteSpace: "normal",
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
