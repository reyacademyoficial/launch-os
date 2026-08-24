import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing · Stock" };

export default function StockPage() {
  return (
    <ModulePlaceholder
      title="Stock de contenido"
      subtitle="Assets editados sin usar y días de cobertura"
      description="En construcción — depende de content_assets (0162), content_uploads (0163) y las cadencias ya cargadas para calcular días de cobertura por dueño × plataforma × formato."
    />
  );
}
