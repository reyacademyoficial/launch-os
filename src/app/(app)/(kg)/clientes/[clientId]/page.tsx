import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { createClient } from "@/lib/supabase/server";

import type { AvailableProject } from "./attach-project-drawer";
import { ProjectsPanel, type AttachedProject } from "./projects-panel";

export const metadata: Metadata = { title: "Cliente · Clientes" };

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly business_name: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly business_name: string | null;
  readonly ownership: "propia" | "externa";
}

// ═══════════════════════════════════════════════════════════════════════════
// Ficha del cliente gestionado.
//
// Trae:
//   - El cliente (rebota con notFound si no existe o no hay permisos).
//   - Los projects atados (client_id = clientId).
//   - Los projects disponibles para atar (client_id IS NULL) — para el
//     drawer del ProjectsPanel.
//
// El bloque de Health / LTV / historial de tickets/renewals/upsells/nps
// llega en commits siguientes. Hoy solo Datos + Projects atados están
// funcionales; el resto queda como placeholder que explica qué viene.
// ═══════════════════════════════════════════════════════════════════════════

export default async function ClienteFichaPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const supabase = await createClient();

  // Dos queries separadas de projects para no interpolar clientId en un
  // filtro `.or(...)` (postgrest no acepta valores parametrizados en OR,
  // y aunque RLS protege del leak, evitamos la inyección de filtros).
  const [clientRes, attachedRes, availableRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, business_name, industry, notes, active")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, business_name, ownership")
      .eq("client_id", clientId)
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, business_name, ownership")
      .is("client_id", null)
      .order("name", { ascending: true }),
  ]);

  const client = clientRes.data as ClientDbRow | null;
  if (!client) notFound();

  const attached: AttachedProject[] = (
    (attachedRes.data ?? []) as unknown as ProjectDbRow[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    businessName: p.business_name,
    ownership: p.ownership,
  }));

  const available: AvailableProject[] = (
    (availableRes.data ?? []) as unknown as ProjectDbRow[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    businessName: p.business_name,
    ownership: p.ownership,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title={client.name}
        stats={[
          { l: "Projects atados", v: String(attached.length) },
          { l: "Estado", v: client.active ? "Activo" : "Archivado" },
          { l: "Health", v: "—" },
          { l: "LTV", v: "—" },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <Panel title="Datos del cliente">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow
              label="Razón social"
              value={client.business_name ?? "—"}
            />
            <FieldRow label="Industria" value={client.industry ?? "—"} />
            <FieldRow
              label="Estado"
              value={
                <StatusPill
                  text={client.active ? "Activo" : "Archivado"}
                  tone={
                    client.active
                      ? "var(--kg-positive-500)"
                      : "var(--kg-neutral-500)"
                  }
                />
              }
            />
            {client.notes && (
              <FieldRow label="Notas" value={client.notes} multiline />
            )}
            <div style={{ marginTop: 4 }}>
              <Link
                href="/clientes"
                className="kg-focus"
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "transparent",
                  border: "1px solid var(--kg-border-subtle)",
                  color: "var(--kg-text-2)",
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                ← Volver al listado
              </Link>
            </div>
          </div>
        </Panel>

        <Panel title="Projects atados">
          <ProjectsPanel
            clientId={client.id}
            attached={attached}
            available={available}
          />
        </Panel>
      </div>

      <Panel title="Health, LTV y actividad">
        <EmptyState
          icon={<IconCli size={22} />}
          title="Historial de relación en construcción"
          hint="En los próximos commits: health score compuesto (NPS + contacto + tickets urgentes), LTV desglosado (settlements + facturas + renewals + upsells cobrados), y sub-tabs con tickets, renovaciones, upsells y respuestas NPS filtrados por este cliente."
        />
      </Panel>
    </div>
  );
}

function FieldRow({
  label,
  value,
  multiline,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly multiline?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 13,
          lineHeight: multiline ? 1.55 : 1.4,
          whiteSpace: multiline ? "pre-wrap" : "normal",
        }}
      >
        {value}
      </div>
    </div>
  );
}
