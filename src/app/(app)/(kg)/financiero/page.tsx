import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Financiero" };

export default function FinancieroPage() {
  return (
    <ModulePlaceholder
      title="Financiero"
      subtitle="Revenue, gastos, cash, patrimonio"
      description="Módulo en construcción. Los selectores puros ya viven en src/lib/finance (revenue, kpis) — solo falta conectar la UI en 6b."
    />
  );
}
