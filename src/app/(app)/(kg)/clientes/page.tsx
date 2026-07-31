import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";

export const metadata: Metadata = { title: "Clientes" };

export default function ClientesPage() {
  return (
    <ModulePlaceholder
      title="Clientes"
      subtitle="Salud, LTV, churn, renovaciones"
      description="Módulo en construcción. Selectores puros ya en src/lib/clients (health, ltv, churn) — la UI llega en 6b."
    />
  );
}
