import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing · Grabación" };

export default function GrabacionPage() {
  return (
    <ModulePlaceholder
      title="Grabación"
      subtitle="Bloque 2 · sesiones con filmaker y experto"
      description="En construcción — migraciones 0160/0161 pendientes (recording_sessions + assignees). Vista tabla y calendario con click en día → drawer con detalle."
    />
  );
}
