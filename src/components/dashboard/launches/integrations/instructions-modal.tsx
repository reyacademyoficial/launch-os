"use client";

import { useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import { smallBtn } from "@/components/kg/form-primitives";
import { KgMarkdown } from "@/components/kg/markdown";

/**
 * Modal de ayuda paso-a-paso para conectar un provider. Genérico — recibe
 * `title` + `markdown` como props, sin saber de qué provider se trata. La
 * página/servidor que lo invoca le pasa el .md leído por
 * `getInstructions(providerId)`.
 *
 * MIGRACIÓN KG
 * El overlay propio (`fixed inset-0` + header + body scrolleable, todo con
 * tokens viejos) pasó a `Drawer`: mismo comportamiento de Esc/click-outside
 * pero centralizado, y en mobile ocupa el ancho completo sin que este archivo
 * tenga que saberlo.
 *
 * El mapeo nodo-por-nodo de `react-markdown` (18 overrides contra `text-fg`,
 * `text-fg-muted`, `border-accent`…) se borró entero: `KgMarkdown` es
 * exactamente ese mapeo contra las CSS vars `--kg-*`. Mantener dos
 * tipografías de markdown en el repo no tenía justificación.
 */
export function InstructionsModal({
  triggerLabel = "¿Cómo conecto?",
  title,
  markdown,
}: {
  readonly triggerLabel?: string;
  readonly title: string;
  readonly markdown: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          ...smallBtn,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <InfoIcon />
        <span>{triggerLabel}</span>
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle="Guía paso a paso para conectar el proveedor."
        // Más ancho que un form-drawer: son instrucciones con bloques de
        // código y URLs largas que no conviene envolver a 560px.
        width={720}
      >
        <KgMarkdown text={markdown} />
      </Drawer>
    </>
  );
}

function InfoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
