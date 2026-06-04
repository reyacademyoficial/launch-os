import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lanzamiento" };

export default async function LaunchDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <section>
      <h1 className="text-2xl font-bold">Lanzamiento {id}</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Detalle de lanzamiento — placeholder. Fase 5.
      </p>
    </section>
  );
}
