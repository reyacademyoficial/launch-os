"use client";

import { useState } from "react";

import {
  EnrollStudentDrawer,
  type EnrollmentInitial,
} from "../../cohortes/[cohortId]/enroll-student-drawer";

/**
 * Botón "Editar" en la ficha del alumno para modificar una inscripción sin
 * salir a la ficha de la generación. Reusa EnrollStudentDrawer con
 * hideSaleField=true — el link a la venta se mantiene tal cual estaba
 * (se persiste vía hidden input); solo se editan fecha de alta, vigencia,
 * estado, progreso y notas.
 */

export function EditEnrollmentButton({
  studentId,
  initial,
  cohortName,
  cohortHasCourse,
  studentName,
  studentEmail,
}: {
  readonly studentId: string;
  readonly initial: EnrollmentInitial;
  readonly cohortName: string;
  readonly cohortHasCourse: boolean;
  readonly studentName: string;
  readonly studentEmail: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
        title="Editar fecha de alta, vigencia y estado"
      >
        Editar
      </button>
      <EnrollStudentDrawer
        mode="edit"
        open={open}
        onClose={() => setOpen(false)}
        cohortId={initial.cohortId}
        cohortName={cohortName}
        cohortHasCourse={cohortHasCourse}
        students={[
          { id: studentId, name: studentName, email: studentEmail },
        ]}
        sales={[]}
        initial={initial}
        hideSaleField
      />
    </>
  );
}
