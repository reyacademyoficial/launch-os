import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing · Disponibilidad" };

export default function DisponibilidadPage() {
  return (
    <ModulePlaceholder
      title="Disponibilidad de editores"
      subtitle="Bloques de disponibilidad por persona"
      description="En construcción — migración 0164 pendiente (editor_availability). Alimenta el planning semanal de la pestaña Edición."
    />
  );
}
