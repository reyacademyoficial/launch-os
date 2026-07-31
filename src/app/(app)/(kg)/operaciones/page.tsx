import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Operaciones" };

export default function OperacionesPage() {
  return (
    <ModulePlaceholder
      title="Operaciones"
      subtitle="Tareas, checklists, procesos, bloqueos"
      description="Módulo en construcción. Selectores en src/lib/ops (carga, throughput, overdue). Acá va a vivir también MiJornada del sidebar cuando conectemos tasks."
    />
  );
}
