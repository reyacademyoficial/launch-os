"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  ImportStudentsButton,
  type ImportProjectOption,
} from "./import-students-button";
import {
  StudentFormDrawer,
  type ProjectOptionForStudent,
} from "./student-form-drawer";

/**
 * Acciones del header del Panel "Estudiantes": importar Excel + crear manual.
 * Vive suelto para pasarse como `actions` del Panel — mismo patrón que
 * NewOwnerButton en marketing (pero con dos botones).
 */
export function StudentPanelActions({
  projects,
  importProjects,
}: {
  readonly projects: readonly ProjectOptionForStudent[];
  readonly importProjects: readonly ImportProjectOption[];
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <ImportStudentsButton projects={importProjects} />
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={panelActionPrimaryBtn}
        >
          + Crear manual
        </button>
      </div>
      <StudentFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        projects={projects}
      />
    </>
  );
}
