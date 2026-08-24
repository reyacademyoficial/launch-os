import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing · Edición" };

export default function EdicionPage() {
  return (
    <ModulePlaceholder
      title="Edición"
      subtitle="Bloque 3 · assets producidos y editor a cargo"
      description="En construcción — migración 0162 pendiente (content_assets). Planning semanal por editor según disponibilidad."
    />
  );
}
