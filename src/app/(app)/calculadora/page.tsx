import type { Metadata } from "next";

import { Calculator } from "@/components/dashboard/calculator/calculator";
import { listAccessibleProjects } from "@/lib/projects/list";
import { listAccessibleProjections } from "@/lib/projections/list";
import { requireSessionProfile } from "@/lib/supabase/auth";

import { deleteProjection, saveProjection } from "./actions";

export const metadata: Metadata = { title: "Calculadora" };

export default async function CalculatorPage() {
  const profile = await requireSessionProfile();
  // Only admin/superadmin can write — listAccessibleProjects() returns the
  // exact set their `can_edit_project` would pass for (membership-based for
  // admins, all for superadmin). Cliente reads-only, no save UI.
  const canSave = profile.role !== "cliente";
  const [projections, editableProjects] = await Promise.all([
    listAccessibleProjections(),
    canSave ? listAccessibleProjects() : Promise.resolve([]),
  ]);

  return (
    <Calculator
      projections={projections}
      editableProjects={editableProjects}
      saveAction={saveProjection}
      deleteAction={deleteProjection}
    />
  );
}
