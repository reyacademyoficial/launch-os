import type { Metadata } from "next";

import { ProviderCard } from "@/components/dashboard/integrations/provider-card";
import { listIntegrationsForProject } from "@/lib/integrations/list";
import { PROVIDERS } from "@/lib/integrations/types";
import { userCanEditProject } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Integraciones" };

export default async function IntegrationsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [integrations, canEdit] = await Promise.all([
    listIntegrationsForProject(projectId),
    userCanEditProject(projectId),
  ]);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Integraciones</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Conectá las cuentas de cada proveedor para que la carga de datos sea
          automática.
        </p>
      </header>

      <aside
        role="note"
        className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning"
      >
        <strong className="font-semibold">Modo stub.</strong> Las credenciales se
        guardan acá pero todavía no llaman a las APIs externas — el sync real
        llega en una iteración posterior. La UI sirve hoy para validar el flujo
        de carga, rotación y desconexión.
      </aside>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            integration={integrations[provider.id]}
            canEdit={canEdit}
            projectId={projectId}
          />
        ))}
      </div>
    </section>
  );
}
