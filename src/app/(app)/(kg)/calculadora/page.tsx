import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Calculator } from "@/components/dashboard/calculator/calculator";
import { canUseCalculator } from "@/lib/auth/permissions";
import { getKgProjects } from "@/lib/kg/reference";
import { listAccessibleProjections } from "@/lib/projections/list";
import { requireSessionProfile } from "@/lib/supabase/auth";

import { deleteProjection, saveProjection } from "./actions";

export const metadata: Metadata = { title: "Calculadora" };

export default async function CalculatorPage() {
  const profile = await requireSessionProfile();
  // Cliente queda fuera del simulador en Fase 2 (vista ejecutiva reducida,
  // sin costos internos). Toggleable en src/lib/auth/permissions.ts.
  if (!canUseCalculator(profile)) redirect("/");
  // Closer solo vive en Ventas/Cobros. Si aterrizan acá, los rebotamos al
  // picker de lanzamientos, que a su vez los envía al /ventas del proyecto.
  if (profile.role === "closer") redirect("/lanzamientos");
  // Save (= insert into `projections`) needs project-scope write, so coordinador
  // and operador can use the simulator but no save UI for them either. dev
  // pasa por is_dev_privileged igual que superadmin.
  const canSave =
    profile.role === "admin" ||
    profile.role === "superadmin" ||
    profile.isDevPrivileged;
  const [projections, editableProjects] = await Promise.all([
    listAccessibleProjections(),
    canSave ? getKgProjects() : Promise.resolve([]),
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
