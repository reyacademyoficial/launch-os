"use client";

import { useState } from "react";

import type { LeadActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/leads/actions";
import { Drawer } from "@/components/kg/drawer";
import { primaryBtn, secondaryBtn } from "@/components/kg/form-primitives";
import type { LeadRow } from "@/lib/leads/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { LeadForm } from "./lead-form";

type FormAction = (prev: LeadActionState, formData: FormData) => Promise<LeadActionState>;

/**
 * Trigger + drawer para crear / editar un lead.
 *
 * Antes era un modal centrado a mano (`fixed inset-0` + caja `max-h-[90vh]`
 * con tokens VIEJOS `bg-bg-elevated` / `border-border`). Ahora el chasis es el
 * `Drawer` de KG: trae Esc-to-close, click-outside, header con título + botón
 * cerrar y cuerpo con scroll propio — mismo contrato de UX, sin markup propio
 * que mantener y respetando dark/light por CSS vars.
 *
 * Por qué drawer y no modal centrado: en 390px el modal con `p-4` dejaba el
 * form en ~358px útiles. El Drawer ocupa el 100% del ancho en mobile y recién
 * a partir de `width` se comporta como panel lateral.
 *
 * El submit queda DENTRO del `<form>` (no en el `footer` del Drawer): el
 * footer es un slot único fuera del form y acá no hace falta bajarlo, el form
 * es corto y el patrón ya es el de `launches/launch-form-modal.tsx`.
 */
export function LeadFormModal({
  triggerLabel,
  triggerVariant = "primary",
  triggerClassName,
  title,
  submitLabel,
  action,
  initial,
  teamMembers,
  launches,
}: {
  readonly triggerLabel: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly triggerClassName?: string;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: LeadRow;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        El trigger sigue siendo un `<button>` real: el kanban le pasa
        `triggerClassName="!px-1.5 !py-0.5 !text-xs"` esperando poder apretar
        padding y tamaño de fuente. Las utilidades `!` de Tailwind emiten
        `!important`, que gana contra el `style` inline — o sea que ese call
        site sigue funcionando sin cambiar nada.

        `minHeight: 36` no cede ante `!py-0.5`: la regla de target de toque del
        design system manda sobre la compactación visual, y el botón igual se
        lee chico porque ancho y tipografía sí se achican.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`kg-focus${triggerClassName ? ` ${triggerClassName}` : ""}`}
        style={{
          ...(triggerVariant === "primary" ? primaryBtn : secondaryBtn),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 36,
          whiteSpace: "nowrap",
        }}
      >
        {triggerLabel}
      </button>

      {/*
        `Drawer` devuelve null cuando `open` es false, así que `LeadForm` no
        monta hasta que se abre y vuelve a montar limpio en cada apertura —
        mismo comportamiento que el `{open && ...}` anterior, y es lo que
        resetea el `useActionState` entre aperturas.
      */}
      <Drawer open={open} onClose={() => setOpen(false)} title={title} width={560}>
        <LeadForm
          action={action}
          initial={initial}
          submitLabel={submitLabel}
          onSuccess={() => setOpen(false)}
          teamMembers={teamMembers}
          launches={launches}
        />
      </Drawer>
    </>
  );
}
