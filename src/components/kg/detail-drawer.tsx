"use client";

import type { ReactNode } from "react";

import { Drawer } from "./drawer";
import { primaryBtn, secondaryBtn } from "./form-primitives";

/**
 * KG · DetailDrawer. Vista de solo lectura de "una fila" — pensado para
 * abrirse con un click en la fila de una tabla (planificación, grabación,
 * edición, crudos), sin tener que entrar directo al form de edición.
 *
 * No reemplaza al drawer de edición: el botón "Editar" del footer es quien
 * dispara `onEdit`, que el caller resuelve abriendo su propio
 * `*FormDrawer` existente (este componente no sabe nada de forms).
 */
export interface DetailField {
  readonly label: string;
  readonly value: ReactNode;
}

export function KgDetailDrawer({
  open,
  onClose,
  onEdit,
  title,
  subtitle,
  fields,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Omitir si la fila no admite edición desde acá. */
  readonly onEdit?: () => void;
  readonly title: string;
  readonly subtitle?: string;
  readonly fields: readonly DetailField[];
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width={480}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="kg-focus" style={secondaryBtn}>
            Cerrar
          </button>
          {onEdit && (
            <button type="button" onClick={onEdit} className="kg-focus" style={primaryBtn}>
              Editar
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {fields.map((f, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", fontWeight: 600, textTransform: "uppercase" }}
            >
              {f.label}
            </span>
            <div style={{ color: "var(--kg-text-1)", fontSize: 13 }}>
              {f.value ?? <span style={{ color: "var(--kg-text-3)" }}>—</span>}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
