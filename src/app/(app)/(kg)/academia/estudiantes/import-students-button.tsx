"use client";

import { useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import { panelActionSecondaryBtn } from "@/components/kg/form-primitives";
import { ImportXlsxDrawer } from "@/components/kg/import-xlsx-drawer";

import {
  confirmStudentsImport,
  previewStudentsImport,
} from "../enrollments/actions";

/**
 * Trigger + drawer para importar alumnos + inscripciones desde Excel.
 *
 * Al abrir, primero muestra un mini-drawer para elegir el proyecto (Academia
 * es project-scoped). Recién con el proyecto elegido, se abre el
 * ImportXlsxDrawer compartido con el `templateHref` y las callbacks que
 * inyectan `projectId` en el FormData antes de llegar al server.
 *
 * Mismo patrón que ImportExpensesButton / ImportMovementsButton — el drawer
 * es un componente genérico de 3 pasos (upload → review → done).
 */

export interface ImportProjectOption {
  readonly id: string;
  readonly name: string;
}

export function ImportStudentsButton({
  projects,
}: {
  readonly projects: readonly ImportProjectOption[];
}) {
  const [openPicker, setOpenPicker] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  const disabled = projects.length === 0;
  const selectedProject = projectId
    ? projects.find((p) => p.id === projectId) ?? null
    : null;

  function handleClosePicker() {
    setOpenPicker(false);
  }

  function handleCloseImport() {
    setProjectId(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Si hay UN solo proyecto, saltamos el picker y abrimos directo.
          if (projects.length === 1) {
            setProjectId(projects[0]!.id);
            return;
          }
          setOpenPicker(true);
        }}
        disabled={disabled}
        className="kg-focus"
        style={{
          ...panelActionSecondaryBtn,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
        title={
          disabled
            ? "Necesitás al menos un proyecto propio para importar alumnos"
            : "Importar alumnos + inscripciones desde Excel"
        }
      >
        Importar Excel
      </button>

      {openPicker && (
        <Drawer
          open={openPicker}
          onClose={handleClosePicker}
          title="Importar alumnos"
          subtitle="Elegí a qué proyecto pertenecen los alumnos"
          width={480}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label
                htmlFor="__import_project"
                className="kg-t7"
                style={{
                  display: "block",
                  color: "var(--kg-text-3)",
                  marginBottom: 6,
                }}
              >
                Proyecto propio
              </label>
              <select
                id="__import_project"
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) {
                    setProjectId(v);
                    setOpenPicker(false);
                  }
                }}
                style={inputStyle}
              >
                <option value="" disabled>
                  — Elegí un proyecto —
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", lineHeight: 1.5 }}
            >
              Los alumnos importados quedan asociados a este proyecto. Si el
              email de una fila matchea con un alumno existente en el mismo
              proyecto, se reusa (no se duplica) — sirve para inscribir un
              alumno a varios cursos con filas separadas.
            </div>
          </div>
        </Drawer>
      )}

      {selectedProject && (
        <ImportXlsxDrawer
          open={selectedProject != null}
          onClose={handleCloseImport}
          title={`Importar alumnos · ${selectedProject.name}`}
          templateHref={`/api/academia/estudiantes/template?projectId=${selectedProject.id}`}
          templateDescription={
            "Descargá la plantilla, completá una fila por inscripción y volvé a subirla. " +
            "Obligatorias: Nombre, Fecha de alta, Producto y Cohorte. " +
            "El nombre del Producto y de la Cohorte tienen que coincidir con los del proyecto — mirá la hoja \"Referencia\" del xlsx para copiarlos exactos. " +
            "La Vigencia hasta vacía = sin vencimiento; si la ponés, ese valor gana."
          }
          onPreview={(fd) => {
            fd.set("projectId", selectedProject.id);
            return previewStudentsImport(null, fd);
          }}
          onConfirm={(fd) => {
            fd.set("projectId", selectedProject.id);
            return confirmStudentsImport(null, fd);
          }}
        />
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
};
