"use client";

import { useState } from "react";

import type { LaunchActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/actions";
import { Drawer } from "@/components/kg/drawer";
import { primaryBtn, secondaryBtn } from "@/components/kg/form-primitives";
import type { LaunchRow } from "@/lib/launches/types";

import { LaunchForm } from "./launch-form";

type FormAction = (
  prev: LaunchActionState,
  formData: FormData,
) => Promise<LaunchActionState>;

/**
 * Trigger + drawer para crear / editar un launch. Es el único consumidor de
 * `LaunchForm` — las rutas `/new` y `/edit` que menciona el comentario
 * histórico ya no existen.
 *
 * Antes esto era un modal centrado a mano (`fixed inset-0` + caja
 * `max-h-[90vh]` con tokens viejos `bg-bg-elevated` / `border-border`). Ahora
 * el chasis es el `Drawer` de KG: trae Esc-to-close, click-outside, header con
 * título + botón cerrar y un cuerpo con scroll propio — o sea, exactamente el
 * mismo contrato de UX que teníamos, pero sin markup propio que mantener y
 * respetando dark/light por CSS vars.
 *
 * Por qué drawer y no modal centrado: en 390px el modal centrado con `p-4`
 * dejaba el form en ~358px de ancho útil y con el header pegado al notch. El
 * Drawer ocupa el 100% del ancho en mobile y recién a partir de `maxWidth`
 * (760px) se comporta como panel lateral, que es donde el grid de 2/3 columnas
 * tiene sentido.
 *
 * No cierro el drawer al éxito desde JS en el caso create — el server action
 * hace `redirect()` después del INSERT, así el navegador navega y el drawer
 * desaparece con la página. En update la action devuelve `{ ok: true }` y
 * `LaunchForm` dispara `onSuccess`. Si hay error, `LaunchForm` lo muestra
 * inline y el drawer queda abierto.
 */
export function LaunchFormModal({
  triggerLabel,
  triggerVariant = "primary",
  triggerClassName,
  title,
  submitLabel,
  action,
  initial,
  copyableLaunches,
  recycleTargetOptions,
}: {
  readonly triggerLabel: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly triggerClassName?: string;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: LaunchRow;
  readonly copyableLaunches?: ReadonlyArray<{ id: string; name: string }>;
  readonly recycleTargetOptions?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        El trigger sigue siendo un `<button>` real: hay call sites que le pasan
        `triggerClassName="!px-2 !py-1 !text-xs"` esperando poder apretar el
        padding y el tamaño de fuente. Las utilidades `!` de Tailwind emiten
        `!important`, que gana contra el `style` inline — así que los overrides
        de esos call sites siguen funcionando sin que ellos cambien nada.

        `minHeight: 36` queda igual aunque llegue `!py-1`: la regla de target
        de toque del design system (36px) manda sobre la compactación visual,
        y el botón sigue leyéndose chico porque el ancho y la tipografía sí se
        achican.
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
        `Drawer` devuelve null cuando `open` es false, así que `LaunchForm` no
        monta hasta que se abre y vuelve a montar limpio en cada apertura —
        mismo comportamiento que el `{open && ...}` que había antes, y es lo
        que resetea el `useActionState` entre aperturas.
      */}
      <Drawer open={open} onClose={() => setOpen(false)} title={title} width={760}>
        <LaunchForm
          action={action}
          initial={initial}
          submitLabel={submitLabel}
          onSuccess={() => setOpen(false)}
          copyableLaunches={copyableLaunches}
          recycleTargetOptions={recycleTargetOptions}
        />
      </Drawer>
    </>
  );
}
