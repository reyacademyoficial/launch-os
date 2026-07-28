"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import type { ProjectionActionState } from "@/app/(app)/(kg)/calculadora/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ForwardInput } from "@/lib/calculator/forward";
import type { ReverseInput } from "@/lib/calculator/reverse";
import type { ProjectionListItem } from "@/lib/projections/types";
import type { ProjectListItem } from "@/lib/projects/list";

export type ProjectionSaveAction = (
  prev: ProjectionActionState,
  formData: FormData,
) => Promise<ProjectionActionState>;

export type ProjectionDeleteAction = (id: string) => Promise<void>;

type Mode = "reverse" | "forward";

export function ProjectionsPanel({
  projections,
  editableProjects,
  currentMode,
  currentInputs,
  onLoad,
  saveAction,
  deleteAction,
}: {
  readonly projections: readonly ProjectionListItem[];
  readonly editableProjects: readonly ProjectListItem[];
  readonly currentMode: Mode;
  readonly currentInputs: ReverseInput | ForwardInput;
  readonly onLoad: (p: ProjectionListItem) => void;
  readonly saveAction: ProjectionSaveAction;
  readonly deleteAction: ProjectionDeleteAction;
}) {
  const [open, setOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const canSave = editableProjects.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated"
        aria-expanded={open}
      >
        Mis proyecciones ({projections.length})
      </button>
      {canSave && (
        <Button type="button" onClick={() => setSaveModalOpen(true)}>
          Guardar
        </Button>
      )}

      {open && (
        <ProjectionsList
          projections={projections}
          onLoad={(p) => {
            onLoad(p);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          deleteAction={deleteAction}
        />
      )}

      {saveModalOpen && (
        <SaveModal
          editableProjects={editableProjects}
          currentMode={currentMode}
          currentInputs={currentInputs}
          saveAction={saveAction}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
    </div>
  );
}

function ProjectionsList({
  projections,
  onLoad,
  onClose,
  deleteAction,
}: {
  readonly projections: readonly ProjectionListItem[];
  readonly onLoad: (p: ProjectionListItem) => void;
  readonly onClose: () => void;
  readonly deleteAction: ProjectionDeleteAction;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="projections-list-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] w-full max-w-xl overflow-hidden rounded-md border border-border bg-bg-elevated shadow-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 id="projections-list-title" className="text-base font-semibold text-fg">
            Proyecciones guardadas
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-fg-muted hover:text-fg"
          >
            Cerrar
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto">
          {projections.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-muted">
              No hay proyecciones guardadas todavía.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projections.map((p) => (
                <ProjectionRow
                  key={p.id}
                  projection={p}
                  onLoad={onLoad}
                  deleteAction={deleteAction}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectionRow({
  projection,
  onLoad,
  deleteAction,
}: {
  readonly projection: ProjectionListItem;
  readonly onLoad: (p: ProjectionListItem) => void;
  readonly deleteAction: ProjectionDeleteAction;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{projection.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {projection.mode}
          </span>
          <span>·</span>
          <span className="truncate">{projection.project_name}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onLoad(projection)}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-bg-elevated"
        >
          Cargar
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await deleteAction(projection.id);
                  setConfirming(false);
                });
              }}
              className="rounded-md bg-error px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "…" : "Confirmar"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(false)}
              className="text-xs text-fg-muted hover:text-fg"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-error/40 bg-surface px-2.5 py-1 text-xs font-medium text-error hover:bg-error/10"
          >
            Borrar
          </button>
        )}
      </div>
    </li>
  );
}

function SaveModal({
  editableProjects,
  currentMode,
  currentInputs,
  saveAction,
  onClose,
}: {
  readonly editableProjects: readonly ProjectListItem[];
  readonly currentMode: Mode;
  readonly currentInputs: ReverseInput | ForwardInput;
  readonly saveAction: ProjectionSaveAction;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ProjectionActionState,
    FormData
  >(saveAction, null);

  // The Server Action revalidates `/calculadora`, but the form is in a modal
  // that we need to close imperatively on success.
  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  const inputsJson = JSON.stringify(currentInputs);
  const errorMessage = state && "error" in state ? state.error : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-projection-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-border bg-bg-elevated p-6 shadow-card">
        <h3 id="save-projection-title" className="text-lg font-bold text-fg">
          Guardar proyección
        </h3>
        <p className="mt-1 text-xs text-fg-subtle">
          Modo actual: <strong className="text-fg">{currentMode}</strong>.
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="mode" value={currentMode} />
          <input type="hidden" name="inputs" value={inputsJson} />

          <div>
            <Label htmlFor="proj-name">Nombre</Label>
            <Input
              id="proj-name"
              name="name"
              required
              autoFocus
              placeholder="Plan Q3 — escenario optimista"
            />
          </div>

          <div>
            <Label htmlFor="proj-project">Proyecto</Label>
            <Select id="proj-project" name="project_id" required defaultValue="">
              <option value="" disabled>
                Elegí un proyecto…
              </option>
              {editableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {errorMessage && <FieldError>{errorMessage}</FieldError>}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
