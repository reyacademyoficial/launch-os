import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Marketing" };

export default function MarketingPage() {
  return (
    <ModulePlaceholder
      title="Marketing"
      subtitle="Campañas, ad spend, atribución"
      description="Módulo en construcción. Se define en un sub-bloque posterior — los datos van a apoyarse en launches, leads y consumo publicitario ya presentes en src/lib."
    />
  );
}
