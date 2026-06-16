import type { Metadata } from "next";

import { Calculator } from "@/components/dashboard/calculator/calculator";
import { listClientProjections } from "@/lib/client-portal/projections";
import { listAccessibleProjects } from "@/lib/projects/list";
import { requireRole } from "@/lib/supabase/auth";

import { deleteClientProjection, saveClientProjection } from "./actions";

export const metadata: Metadata = { title: "Calculadora · Portal" };

/**
 * Calculadora del cliente con guardado propio (decisión Fase 6, A.2).
 *
 * Re-usamos el componente `Calculator` del equipo entero:
 *   - `editableProjects`: todos los proyectos del cliente (no se filtra por
 *     can_edit_project; el cliente "edita" la proyección, no el proyecto).
 *   - `projections`: solo las suyas (`created_by = auth.uid()`), filtradas
 *     en server. La RLS además garantiza que no pueda tocar las del equipo
 *     aunque alguien forzara un id ajeno.
 *   - actions: variantes server con requireRole('cliente'), no admin.
 */
export default async function ClientCalculatorPage() {
  const profile = await requireRole("cliente");
  const [projections, projects] = await Promise.all([
    listClientProjections(profile.id),
    listAccessibleProjects(),
  ]);

  return (
    <Calculator
      projections={projections}
      editableProjects={projects}
      saveAction={saveClientProjection}
      deleteAction={deleteClientProjection}
    />
  );
}
