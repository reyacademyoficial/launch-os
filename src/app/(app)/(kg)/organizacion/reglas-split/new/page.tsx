import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { SettlementRuleRow } from "@/lib/settlements/types";

import { RuleForm, type LaunchOption, type ProjectContext } from "../rule-form";

export const metadata: Metadata = { title: "Nueva regla de split" };

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
  readonly organization_id: string;
}

export default async function NuevaReglaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("superadmin");
  const sp = await searchParams;

  const projectId = typeof sp.projectId === "string" ? sp.projectId : null;
  if (!projectId) notFound();

  const launchIdParam =
    typeof sp.launchId === "string" ? sp.launchId : null;
  const scope = typeof sp.scope === "string" ? sp.scope : null;
  const isOverride = scope === "override" || launchIdParam !== null;

  const supabase = await createClient();
  const [projectRes, launchesRes, rulesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, ownership, organization_id")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("launches")
      .select("id, name")
      .eq("project_id", projectId)
      .order("name", { ascending: true }),
    supabase
      .from("settlement_rules")
      .select(
        "id, organization_id, project_id, launch_id, name, percent_of_collected, fixed_fee_per_launch, fixed_fee_per_sale, min_guarantee, applies_on, active, created_at, updated_at, created_by",
      )
      .eq("project_id", projectId)
      .eq("active", true),
  ]);

  const project = projectRes.data as ProjectRow | null;
  if (!project) notFound();

  const launches = ((launchesRes.data ?? []) as { id: string; name: string | null }[]).map(
    (l): LaunchOption => ({
      id: l.id,
      name: l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`,
    }),
  );

  const activeRules = (rulesRes.data ?? []) as SettlementRuleRow[];

  const context: ProjectContext = {
    id: project.id,
    name: project.name,
    ownership: project.ownership,
    organizationId: project.organization_id,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-baseline gap-3">
        <a
          href="/organizacion/reglas-split"
          className="text-sm text-fg-muted hover:text-fg"
        >
          ← Reglas de split
        </a>
        <h1 className="text-2xl font-bold">
          {isOverride ? "Nuevo override" : "Nueva regla default"}
        </h1>
      </header>

      <RuleForm
        mode="new"
        project={context}
        launches={launches}
        activeRules={activeRules}
        editingRule={null}
        initialLaunchId={launchIdParam}
        isOverrideNew={isOverride}
      />
    </section>
  );
}
