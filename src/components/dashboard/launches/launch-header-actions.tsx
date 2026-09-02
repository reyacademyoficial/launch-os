"use client";

import { useState } from "react";

import type { LaunchActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/actions";
import { KgBottomSheet } from "@/components/kg/bottom-sheet";
import type { LaunchRow } from "@/lib/launches/types";

import { DeleteButton } from "./delete-button";
import { LaunchFormModal } from "./launch-form-modal";

type FormAction = (
  prev: LaunchActionState,
  formData: FormData,
) => Promise<LaunchActionState>;

/**
 * Cluster de acciones del header del launch. Colapsa las secundarias en un
 * bottom-sheet en mobile — el header traía 5-6 botones inline que wrappeaban
 * en 2-3 filas y comían pantalla.
 *
 * Layout:
 *   - Desktop (`md+`): botones inline en fila (patrón original).
 *   - Mobile: solo "Editar" como primary + botón kebab "Más" que abre un
 *     `KgBottomSheet` con PDFs, Duplicar, Cerrar/Reabrir y Borrar.
 *
 * El sheet renderea `DeleteButton` como fila — al confirmar borra abre su
 * propio dialog encima. `DeleteButton` fue subido a `z-[2100]` para no
 * quedar por debajo del sheet (`z-2000`).
 *
 * Los `<form action={...}>` de Duplicar/Cerrar/Reabrir viven dentro del sheet
 * también; el submit dispara el Server Action y navega, que cierra el sheet
 * junto con la página.
 */
export function LaunchHeaderActions({
  launchName,
  isClosed,
  canEditLaunch,
  canEditProject,
  pdfExecutiveUrl,
  pdfCommissionsUrl,
  updateAction,
  deleteAction,
  closeAction,
  reopenAction,
  duplicateAction,
  initial,
  recycleTargetOptions,
}: {
  readonly launchName: string;
  readonly isClosed: boolean;
  readonly canEditLaunch: boolean;
  readonly canEditProject: boolean;
  readonly pdfExecutiveUrl: string;
  readonly pdfCommissionsUrl: string;
  readonly updateAction: FormAction;
  readonly deleteAction: () => Promise<void>;
  readonly closeAction: () => Promise<void>;
  readonly reopenAction: () => Promise<void>;
  readonly duplicateAction: () => Promise<void>;
  readonly initial: LaunchRow;
  readonly recycleTargetOptions: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const secondaryBtnCls =
    "inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-bg-elevated";

  // Fila mobile: siempre visible como fila full width dentro de un sheet item.
  const sheetItemCls =
    "flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-3 text-sm font-medium text-fg hover:bg-bg-elevated";

  return (
    <>
      {/* Desktop — botones inline (comportamiento original) */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {canEditLaunch && (
          <a href={pdfExecutiveUrl} className={secondaryBtnCls}>
            ⬇ PDF ejecutivo
          </a>
        )}
        {canEditProject && (
          <a href={pdfCommissionsUrl} className={secondaryBtnCls}>
            ⬇ PDF comisiones
          </a>
        )}
        {canEditLaunch && (
          <LaunchFormModal
            triggerLabel="Editar"
            triggerVariant="secondary"
            title="Editar lanzamiento"
            submitLabel="Guardar cambios"
            action={updateAction}
            initial={initial}
            recycleTargetOptions={recycleTargetOptions}
          />
        )}
        {canEditLaunch && (
          <form action={duplicateAction}>
            <button type="submit" className={secondaryBtnCls}>
              Duplicar
            </button>
          </form>
        )}
        {canEditLaunch &&
          (isClosed ? (
            <form action={reopenAction}>
              <button type="submit" className={secondaryBtnCls}>
                Reabrir
              </button>
            </form>
          ) : (
            <form action={closeAction}>
              <button type="submit" className={secondaryBtnCls}>
                Cerrar lanzamiento
              </button>
            </form>
          ))}
        {canEditLaunch && (
          <DeleteButton launchName={launchName} onConfirm={deleteAction} />
        )}
      </div>

      {/* Mobile — Editar visible + kebab */}
      <div className="flex items-center gap-2 md:hidden">
        {canEditLaunch && (
          <LaunchFormModal
            triggerLabel="Editar"
            triggerVariant="secondary"
            title="Editar lanzamiento"
            submitLabel="Guardar cambios"
            action={updateAction}
            initial={initial}
            recycleTargetOptions={recycleTargetOptions}
          />
        )}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Más acciones"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg hover:bg-bg-elevated"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>

      <KgBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        ariaLabel="Acciones del lanzamiento"
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Acciones
        </div>
        <div className="flex flex-col gap-2">
          {canEditLaunch && (
            <a
              href={pdfExecutiveUrl}
              className={sheetItemCls}
              onClick={() => setSheetOpen(false)}
            >
              ⬇ PDF ejecutivo
            </a>
          )}
          {canEditProject && (
            <a
              href={pdfCommissionsUrl}
              className={sheetItemCls}
              onClick={() => setSheetOpen(false)}
            >
              ⬇ PDF comisiones
            </a>
          )}
          {canEditLaunch && (
            <form action={duplicateAction}>
              <button type="submit" className={sheetItemCls}>
                Duplicar
              </button>
            </form>
          )}
          {canEditLaunch &&
            (isClosed ? (
              <form action={reopenAction}>
                <button type="submit" className={sheetItemCls}>
                  Reabrir
                </button>
              </form>
            ) : (
              <form action={closeAction}>
                <button type="submit" className={sheetItemCls}>
                  Cerrar lanzamiento
                </button>
              </form>
            ))}
          {canEditLaunch && (
            <DeleteButton launchName={launchName} onConfirm={deleteAction} />
          )}
        </div>
      </KgBottomSheet>
    </>
  );
}
