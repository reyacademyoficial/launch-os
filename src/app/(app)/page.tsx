import type { Metadata } from "next";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Overview</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Overview del proyecto activo — placeholder. Se llena en Fase 5 con los KPIs
        agregados de todos los lanzamientos del proyecto.
      </p>
    </section>
  );
}
