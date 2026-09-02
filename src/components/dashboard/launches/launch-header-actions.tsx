"use client";

import { useState, type CSSProperties } from "react";

import type { LaunchActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/actions";
import { KgBottomSheet } from "@/components/kg/bottom-sheet";
import { secondaryBtn } from "@/components/kg/form-primitives";
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
 * MIGRACIÓN KG
 * Los tres clusters de clases inline (`secondaryBtnCls`, `sheetItemCls` y el
 * cuadrado del kebab) estaban escritos con tokens VIEJOS — `border-border`,
 * `bg-surface`, `text-fg`, `hover:bg-bg-elevated`. Ahora salen de
 * `secondaryBtn` de `form-primitives`: un solo objeto de estilo con vars
 * `--kg-*`, del que las dos variantes locales son derivaciones explícitas
 * (`sheetItemStyle` y `kebabStyle`) en vez de tres strings que había que
 * mantener sincronizados a ojo.
 *
 * No se usa `primaryBtn`: en este header NINGUNA acción es la primaria de la
 * página — "Editar" ya llega como `triggerVariant="secondary"` desde
 * `LaunchFormModal`, y darle peso de primario a "Duplicar" o "Cerrar" haría
 * competir cinco botones por la misma jerarquía. El único acento es
 * `dangerBtn`, y vive dentro de `DeleteButton`.
 *
 * El sheet renderea `DeleteButton` como fila (`fullWidth`) — al confirmar
 * abre `KgConfirmDialog`, que se apila en `KG_Z_CONFIRM` (2100) por encima
 * del sheet (2000). Esa escalera está documentada en `kg/confirm-dialog.tsx`.
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

  return (
    <>
      {/* Desktop — botones inline (comportamiento original) */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {canEditLaunch && (
          <a href={pdfExecutiveUrl} className="kg-focus" style={linkBtnStyle}>
            ⬇ PDF ejecutivo
          </a>
        )}
        {canEditProject && (
          <a href={pdfCommissionsUrl} className="kg-focus" style={linkBtnStyle}>
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
            <button type="submit" className="kg-focus" style={secondaryBtn}>
              Duplicar
            </button>
          </form>
        )}
        {canEditLaunch &&
          (isClosed ? (
            <form action={reopenAction}>
              <button type="submit" className="kg-focus" style={secondaryBtn}>
                Reabrir
              </button>
            </form>
          ) : (
            <form action={closeAction}>
              <button type="submit" className="kg-focus" style={secondaryBtn}>
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
          className="kg-focus kg-hov"
          style={kebabStyle}
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
              className="kg-focus"
              style={sheetItemStyle}
              onClick={() => setSheetOpen(false)}
            >
              ⬇ PDF ejecutivo
            </a>
          )}
          {canEditProject && (
            <a
              href={pdfCommissionsUrl}
              className="kg-focus"
              style={sheetItemStyle}
              onClick={() => setSheetOpen(false)}
            >
              ⬇ PDF comisiones
            </a>
          )}
          {canEditLaunch && (
            <form action={duplicateAction}>
              <button type="submit" className="kg-focus" style={sheetItemStyle}>
                Duplicar
              </button>
            </form>
          )}
          {canEditLaunch &&
            (isClosed ? (
              <form action={reopenAction}>
                <button
                  type="submit"
                  className="kg-focus"
                  style={sheetItemStyle}
                >
                  Reabrir
                </button>
              </form>
            ) : (
              <form action={closeAction}>
                <button
                  type="submit"
                  className="kg-focus"
                  style={sheetItemStyle}
                >
                  Cerrar lanzamiento
                </button>
              </form>
            ))}
          {canEditLaunch && (
            <DeleteButton
              launchName={launchName}
              onConfirm={deleteAction}
              fullWidth
            />
          )}
        </div>
      </KgBottomSheet>
    </>
  );
}

/**
 * Los PDFs son `<a>`, no `<button>`: `secondaryBtn` no trae `display` ni
 * `textDecoration`, así que un anchor heredaría el subrayado del layout y
 * quedaría con la altura del texto en vez de la del botón de al lado.
 */
const linkBtnStyle: CSSProperties = {
  ...secondaryBtn,
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

/**
 * Fila del bottom-sheet: mismo botón, pero full width y alineado a la
 * izquierda. El padding sube a 11px porque en 390px el target táctil de
 * `secondaryBtn` (8px) queda por debajo de los 44px cómodos.
 */
const sheetItemStyle: CSSProperties = {
  ...secondaryBtn,
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "11px 14px",
  fontSize: 13,
  textAlign: "left",
  textDecoration: "none",
};

/** Kebab: cuadrado 36px, mismo borde/fondo que el resto del cluster. */
const kebabStyle: CSSProperties = {
  ...secondaryBtn,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: "var(--kg-r-8)",
};
