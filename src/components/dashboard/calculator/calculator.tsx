"use client";

import { useMemo, useState } from "react";

import {
  FORWARD_DEFAULTS,
  type ForwardInput,
} from "@/lib/calculator/forward";
import {
  REVERSE_DEFAULTS,
  type ReverseInput,
} from "@/lib/calculator/reverse";
import type { ProjectionListItem } from "@/lib/projections/types";
import type { ProjectListItem } from "@/lib/projects/list";

import {
  CALENDAR_CALC_DEFAULTS,
  CalendarSection,
  type CalendarCalcInput,
} from "./calendar-section";
import { ForwardSection } from "./forward-section";
import { ProjectionsPanel } from "./projections-panel";
import type {
  ProjectionDeleteAction,
  ProjectionSaveAction,
} from "./projections-panel";
import { ReverseSection } from "./reverse-section";

type Mode = "reverse" | "forward" | "calendario";

export function Calculator({
  projections,
  editableProjects,
  saveAction,
  deleteAction,
}: {
  readonly projections: readonly ProjectionListItem[];
  readonly editableProjects: readonly ProjectListItem[];
  readonly saveAction: ProjectionSaveAction;
  readonly deleteAction: ProjectionDeleteAction;
}) {
  const [mode, setMode] = useState<Mode>("reverse");
  // Keep input state OUTSIDE the section components so switching modes back
  // and forth preserves what the user typed in the inactive mode.
  const [reverseInput, setReverseInput] = useState<ReverseInput>(REVERSE_DEFAULTS);
  const [forwardInput, setForwardInput] = useState<ForwardInput>(FORWARD_DEFAULTS);
  // El calendario es efímero — su input vive acá en memoria y no se guarda en
  // `projections` (la API de save/load solo cubre reverse + forward).
  const [calendarInput, setCalendarInput] = useState<CalendarCalcInput>(
    CALENDAR_CALC_DEFAULTS,
  );

  const currentInputs = useMemo(
    () => (mode === "reverse" ? reverseInput : forwardInput),
    [mode, reverseInput, forwardInput],
  );

  function loadProjection(p: ProjectionListItem) {
    if (p.mode === "reverse") {
      setReverseInput(p.inputs as ReverseInput);
      setMode("reverse");
    } else {
      setForwardInput(p.inputs as ForwardInput);
      setMode("forward");
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Launch Revenue Simulator</h1>
          <p className="text-sm text-fg-muted">
            Modelá escenarios. Guardá los importantes para volver a ellos.
          </p>
        </div>
        {/* El panel de guardar/cargar solo aplica a reverse + forward. El modo
            calendario es efímero (no toca DB), así que ocultamos el panel
            para que no haya un "Guardar" engañoso. */}
        {mode !== "calendario" && (
          <ProjectionsPanel
            projections={projections}
            editableProjects={editableProjects}
            currentMode={mode}
            currentInputs={currentInputs}
            onLoad={loadProjection}
            saveAction={saveAction}
            deleteAction={deleteAction}
          />
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        <ModeButton active={mode === "reverse"} onClick={() => setMode("reverse")}>
          Reverse · meta → presupuesto
        </ModeButton>
        <ModeButton active={mode === "forward"} onClick={() => setMode("forward")}>
          Forward · presupuesto → resultados
        </ModeButton>
        <ModeButton
          active={mode === "calendario"}
          onClick={() => setMode("calendario")}
        >
          Calendario · fechas del lanzamiento
        </ModeButton>
      </div>

      {mode === "reverse" && (
        <ReverseSection input={reverseInput} setInput={setReverseInput} />
      )}
      {mode === "forward" && (
        <ForwardSection input={forwardInput} setInput={setForwardInput} />
      )}
      {mode === "calendario" && (
        <CalendarSection input={calendarInput} setInput={setCalendarInput} />
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border px-3 py-2 text-xs font-semibold transition-colors " +
        (active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-surface text-fg-muted hover:text-fg")
      }
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
