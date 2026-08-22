"use client";

import { useState } from "react";

import {
  CohortFormDrawer,
  type CohortInitial,
  type CourseOptionForCohort,
  type ProjectOptionForCohort,
  type SystemOptionForCohort,
} from "../cohort-form-drawer";

export function EditCohortButton({
  projects,
  courses,
  systems,
  initial,
}: {
  readonly projects: readonly ProjectOptionForCohort[];
  readonly courses: readonly CourseOptionForCohort[];
  readonly systems?: readonly SystemOptionForCohort[];
  readonly initial: CohortInitial;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          background: "var(--kg-accent-500)",
          border: "none",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Editar
      </button>
      <CohortFormDrawer
        mode="edit"
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        courses={courses}
        systems={systems}
        initial={initial}
      />
    </>
  );
}
