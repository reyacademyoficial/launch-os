import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing · Subidas" };

export default function SubidasPage() {
  return (
    <ModulePlaceholder
      title="Subidas"
      subtitle="Bloque 4 · programación y estado por plataforma"
      description="En construcción — migración 0163 pendiente (content_uploads). Vista tabla y calendario. Marcar como subido dispara la transición del piece a publicado."
    />
  );
}
