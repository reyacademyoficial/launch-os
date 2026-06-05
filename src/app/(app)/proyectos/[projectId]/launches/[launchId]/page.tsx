import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lanzamiento" };

export default async function LaunchDetailPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;
  return (
    <section>
      <h1 className="text-2xl font-bold">Lanzamiento {launchId}</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Detalle del lanzamiento — placeholder. Fase 5.B. (proyecto {projectId})
      </p>
    </section>
  );
}
