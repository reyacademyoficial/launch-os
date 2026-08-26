"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  CohortFormDrawer,
  type CourseOptionForCohort,
  type ProjectOptionForCohort,
  type SystemOptionForCohort,
} from "./cohort-form-drawer";

/**
 * Botón "+ Nueva generación" + drawer create. Vive suelto para pasarse como
 * `actions` del Panel — mismo patrón que NewOwnerButton en marketing.
 */
export function NewCohortButton({
  projects,
  courses,
  systems,
}: {
  readonly projects: readonly ProjectOptionForCohort[];
  readonly courses: readonly CourseOptionForCohort[];
  readonly systems?: readonly SystemOptionForCohort[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={panelActionPrimaryBtn}
      >
        + Nueva generación
      </button>
      <CohortFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        courses={courses}
        systems={systems}
      />
    </>
  );
}
