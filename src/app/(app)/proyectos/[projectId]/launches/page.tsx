import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lanzamientos" };

export default function LaunchesPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Lanzamientos</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Listado de lanzamientos — placeholder. Fase 5.
      </p>
    </section>
  );
}
