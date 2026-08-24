import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing · Planificación" };

export default function PlanificacionPage() {
  return (
    <ModulePlaceholder
      title="Planificación"
      subtitle="Bloque 1 · plan editorial por dueño"
      description="En construcción — migración 0159 pendiente (content_pieces). Definí guión, tipo, formato, plataformas, fechas de grabación y publicación por pieza de contenido."
    />
  );
}
