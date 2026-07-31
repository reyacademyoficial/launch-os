import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Academia" };

export default function AcademiaPage() {
  return (
    <ModulePlaceholder
      title="Academia"
      subtitle="Cursos, inscripciones, asistencia, certificados"
      description="Módulo en construcción. KPIs disponibles en src/lib/academia. Conexión de UI en 6b+."
    />
  );
}
