"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  CertificateFormDrawer,
  type CourseOptionForCert,
  type StudentOptionForCert,
} from "./certificate-form-drawer";

/**
 * Botón "+ Emitir certificado" + drawer create. Vive suelto para pasarse
 * como `actions` del Panel — patrón marketing.
 */
export function NewCertificateButton({
  students,
  courses,
}: {
  readonly students: readonly StudentOptionForCert[];
  readonly courses: readonly CourseOptionForCert[];
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
        + Emitir certificado
      </button>
      <CertificateFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        students={students}
        courses={courses}
      />
    </>
  );
}
