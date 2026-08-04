import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconCli } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { ClientesView, type ClientRowData } from "./clientes-view";

export const metadata: Metadata = { title: "Clientes" };

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard del módulo Clientes.
//
// Trae TODAS las filas de clients + los projects atados (para el contador
// por cliente). Sin paginación por ahora — con ~decenas de clientes es un
// non-issue; si crece, se agrega paginación con searchParams igual que
// gastos/nomina.
//
// Filtro por estado vía ?show=active|inactive|all (default active). Sigue
// el patrón de organizacion/personas.
//
// TODO al construir dashboard real: agregar KPIs de health/LTV/churn en
// ContextBar y una tabla superior con los últimos movimientos. Hoy los
// stats son conteos simples.
// ═══════════════════════════════════════════════════════════════════════════

type ShowFilter = "active" | "inactive" | "all";

const SHOW_OPTIONS: ReadonlyArray<{ value: ShowFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Archivados" },
  { value: "all", label: "Todos" },
];

interface ClientDbRow {
  readonly id: string;
  readonly name: string;
  readonly business_name: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

interface ProjectClientLink {
  readonly client_id: string | null;
}

export default async function ClientesDashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = parseShow(sp.show);

  const supabase = await createClient();

  const [clientsRes, projectsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, business_name, industry, notes, active")
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("client_id")
      .not("client_id", "is", null),
  ]);

  const allClients = (clientsRes.data ?? []) as unknown as ClientDbRow[];
  const projectLinks =
    (projectsRes.data ?? []) as unknown as ProjectClientLink[];

  // Contador de projects por client_id.
  const projectsByClient = new Map<string, number>();
  for (const link of projectLinks) {
    if (!link.client_id) continue;
    projectsByClient.set(
      link.client_id,
      (projectsByClient.get(link.client_id) ?? 0) + 1,
    );
  }

  const activeCount = allClients.filter((c) => c.active).length;
  const inactiveCount = allClients.length - activeCount;

  const filtered = allClients.filter((c) => {
    if (show === "active") return c.active;
    if (show === "inactive") return !c.active;
    return true;
  });

  const rows: ClientRowData[] = filtered.map((c) => ({
    id: c.id,
    name: c.name,
    businessName: c.business_name,
    industry: c.industry,
    notes: c.notes,
    active: c.active,
    projectsCount: projectsByClient.get(c.id) ?? 0,
  }));

  function buildHref(nextShow: ShowFilter): string {
    const params = new URLSearchParams();
    if (nextShow !== "active") params.set("show", nextShow);
    const qs = params.toString();
    return qs ? `/clientes?${qs}` : "/clientes";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconCli size={16} />}
        title="Clientes"
        stats={[
          { l: "Total", v: fCount(allClients.length) },
          { l: "Activos", v: fCount(activeCount) },
          { l: "Archivados", v: fCount(inactiveCount) },
        ]}
      />

      <KgParamPills
        ariaLabel="Filtrar por estado"
        options={SHOW_OPTIONS.map((o) => ({
          label: o.label,
          href: buildHref(o.value),
          active: show === o.value,
        }))}
      />

      <Panel title="Clientes gestionados">
        <ClientesView rows={rows} totalCount={rows.length} />
      </Panel>
    </div>
  );
}

function parseShow(v: string | string[] | undefined): ShowFilter {
  if (typeof v !== "string") return "active";
  if (v === "inactive" || v === "all") return v;
  return "active";
}
