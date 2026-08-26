"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  CourseFormDrawer,
  type ExternalAppOptionForCourse,
  type ProductOptionForCourse,
} from "./course-form-drawer";

/**
 * Botón "+ Nuevo curso" + drawer create. Vive suelto para pasarse como
 * `actions` del Panel — patrón marketing.
 */
export function NewCourseButton({
  products,
  externalApps,
}: {
  readonly products: readonly ProductOptionForCourse[];
  readonly externalApps: readonly ExternalAppOptionForCourse[];
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
        + Nuevo curso
      </button>
      <CourseFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        products={products}
        externalApps={externalApps}
      />
    </>
  );
}
