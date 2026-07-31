import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/kg/module-placeholder";
import { requireSessionProfile } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Ejecutivo" };

/**
 * Home de Kingrow para no-cliente = módulo Ejecutivo. En 6a es un placeholder
 * — la vista real se construye en 6b junto con el resto de los KPIs de
 * empresa (revenue neto, margen, cash, leaderboard). Los selectores puros ya
 * existen en src/lib/finance, src/lib/clients, etc.
 */
export default async function EjecutivoPage() {
  const profile = await requireSessionProfile();
  return (
    <ModulePlaceholder
      title="Ejecutivo"
      subtitle="Panorama consolidado de la empresa"
      description={
        `Hola ${profile.fullName ?? profile.email ?? "equipo"}, la vista ejecutiva ` +
        "se construye en el próximo sub-bloque. Va a mostrar KPIs consolidados " +
        "(revenue, margen, cash, leaderboard) con los selectores que ya viven en " +
        "src/lib/{finance,clients,academia,ops}."
      }
    />
  );
}
