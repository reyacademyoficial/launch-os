import type { Metadata } from "next";

export const metadata: Metadata = { title: "Integraciones" };

export default function IntegrationsPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Integraciones</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Carga de API keys (Meta, Google, TikTok, WhatsApp). Solo admin+ — placeholder.
        Fase 7: UI + Server Action que escribe en <code>project_secrets</code> con
        service-role; sin OAuth real.
      </p>
    </section>
  );
}
