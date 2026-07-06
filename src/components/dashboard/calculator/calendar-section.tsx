"use client";

import { useEffect, useMemo } from "react";

import { LaunchCalendarTable } from "@/components/dashboard/launches/launch-calendar-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tryComputeLaunchCalendar } from "@/lib/launches/calendar";

/**
 * Calculadora efímera de fechas (Fase C). Reusa `tryComputeLaunchCalendar` +
 * `LaunchCalendarTable` — la misma lógica/render del calendario que vive
 * dentro de un lanzamiento, pero sin proyecto ni launch detrás. **No
 * persiste nada**: todo el estado es client-side en memoria.
 *
 * El componente es solo presentational + computo derivado; el state vive
 * en el parent `<Calculator>` para no perder los inputs al cambiar de modo.
 */

export interface CalendarCalcInput {
  /** YYYY-MM-DD. Vacío al inicio en SSR; el primer mount lo rellena. */
  launchDate: string;
  durCreacion: number;
  durNutricion: number;
  durCaptacion: number;
  durCalentamiento: number;
  durCompra: number;
  durCierre: number;
  isEvergreen: boolean;
}

/**
 * Defaults pedidos por ventas (30 / 15 / 15 / 7 / 7 / 3) — distintos de los
 * del launch real (30 / 15 / 21 / 14 / 5 / 3) porque acá es el cronograma
 * que se le suele mostrar al prospecto. Editables como cualquier input.
 *
 * `launchDate` queda en "" para evitar mismatch SSR/cliente con
 * `new Date()` — el `useEffect` del componente lo setea a hoy+30 al
 * primer render del cliente.
 */
export const CALENDAR_CALC_DEFAULTS: CalendarCalcInput = {
  launchDate: "",
  durCreacion: 30,
  durNutricion: 15,
  durCaptacion: 15,
  durCalentamiento: 7,
  durCompra: 7,
  durCierre: 3,
  isEvergreen: false,
};

function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function CalendarSection({
  input,
  setInput,
}: {
  readonly input: CalendarCalcInput;
  readonly setInput: (next: CalendarCalcInput) => void;
}) {
  // Auto-llenar la fecha al primer mount del cliente. No lo hacemos en el
  // initial state porque `new Date()` corre distinto en SSR vs cliente y
  // tiraría un hydration mismatch.
  useEffect(() => {
    if (!input.launchDate) {
      setInput({ ...input, launchDate: todayPlus(30) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calendar = useMemo(
    () =>
      tryComputeLaunchCalendar({
        launchDate: input.launchDate || undefined,
        durCreacion: input.durCreacion,
        durNutricion: input.durNutricion,
        durCaptacion: input.durCaptacion,
        durCalentamiento: input.durCalentamiento,
        durCompra: input.durCompra,
        durCierre: input.durCierre,
      }),
    [input],
  );

  const setNum =
    <
      K extends
        | "durCreacion"
        | "durNutricion"
        | "durCaptacion"
        | "durCalentamiento"
        | "durCompra"
        | "durCierre",
    >(
      key: K,
    ) =>
    (raw: string) => {
      const parsed = parseInt(raw, 10);
      const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      setInput({ ...input, [key]: next });
    };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
      <aside className="space-y-4 rounded-md border border-border bg-surface p-5 lg:sticky lg:top-4">
        <div>
          <Label htmlFor="cal-launch-date">Fecha de inicio (Clase 1)</Label>
          <Input
            id="cal-launch-date"
            type="date"
            value={input.launchDate}
            onChange={(e) => setInput({ ...input, launchDate: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DurField
            label="Días creación"
            id="cal-dur-creacion"
            value={input.durCreacion}
            onChange={setNum("durCreacion")}
          />
          <DurField
            label="Días nutrición"
            id="cal-dur-nutricion"
            value={input.durNutricion}
            onChange={setNum("durNutricion")}
          />
          <DurField
            label="Días captación"
            id="cal-dur-captacion"
            value={input.durCaptacion}
            onChange={setNum("durCaptacion")}
          />
          <DurField
            label="Días calentamiento"
            id="cal-dur-calentamiento"
            value={input.durCalentamiento}
            onChange={setNum("durCalentamiento")}
          />
          <DurField
            label="Días compra"
            id="cal-dur-compra"
            value={input.durCompra}
            onChange={setNum("durCompra")}
          />
          <DurField
            label="Días cierre"
            id="cal-dur-cierre"
            value={input.durCierre}
            onChange={setNum("durCierre")}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={input.isEvergreen}
            onChange={(e) =>
              setInput({ ...input, isEvergreen: e.target.checked })
            }
            className="accent-accent"
          />
          Este lanzamiento es evergreen
        </label>
        {input.isEvergreen && (
          <p className="text-xs text-fg-subtle">
            Un evergreen corre constantemente: al cerrarse, los leads no
            convertidos se reciclan al próximo. El calendario es idéntico —
            esto es solo el escenario que le mostrás al prospecto.
          </p>
        )}

        <p className="text-xs text-fg-subtle">
          Herramienta efímera: no se crea ningún lanzamiento ni se guarda en
          la base de datos.
        </p>
      </aside>

      <div className="rounded-md border border-border bg-surface p-4">
        {calendar ? (
          <LaunchCalendarTable calendar={calendar} />
        ) : (
          <p className="text-sm text-fg-muted">
            Cargá una fecha de inicio para ver el calendario.
          </p>
        )}
      </div>
    </div>
  );
}

function DurField({
  label,
  id,
  value,
  onChange,
}: {
  readonly label: string;
  readonly id: string;
  readonly value: number;
  readonly onChange: (raw: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min="0"
        step="1"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
