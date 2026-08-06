"use client";

import { useState } from "react";

import {
  StudentFormDrawer,
  type ProjectOptionForStudent,
  type StudentInitial,
} from "../student-form-drawer";

export function EditStudentButton({
  projects,
  initial,
}: {
  readonly projects: readonly ProjectOptionForStudent[];
  readonly initial: StudentInitial;
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
      <StudentFormDrawer
        mode="edit"
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        initial={initial}
      />
    </>
  );
}
