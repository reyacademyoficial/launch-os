import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { SettlementRuleRow } from "@/lib/settlements/types";

import {
  RuleForm,
  type LaunchOption,
  type ProjectContext,
} from "../../rule-form";

export const metadata: Metadata = { title: "Editar regla de split" };

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
  readonly organization_id: string;
}

export default async function EditarReglaPage({
  params,
}: {
  readonly params: Promise<{ ruleId: string }>;
}) {
  await requireRole("superadmin");
  const { ruleId } = await params;

  const supabase = await createClient();
  const ruleRes = await supabase
    .from("settlement_rules")
    .select(
      "id, organization_id, project_id, launch_id, name, percent_of_collected, fixed_fee_per_launch, fixed_fee_per_sale, min_guarantee, applies_on, active, created_at, updated_at, created_by",
    )
    .eq("id", ruleId)
    .maybeSingle();

  const rule = ruleRes.data as SettlementRuleRow | null;
  if (!rule) notFound();

  const [projectRes, launchesRes, activeRulesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, ownership, organization_id")
      .eq("id", rule.project_id)
      .maybeSingle(),
    supabase
      .from("launches")
      .select("id, name")
      .eq("project_id", rule.project_id)
      .order("name", { ascending: true }),
    supabase
      .from("settlement_rules")
      .select(
        "id, organization_id, project_id, launch_id, name, percent_of_collected, fixed_fee_per_launch, fixed_fee_per_sale, min_guarantee, applies_on, active, created_at, updated_at, created_by",
      )
      .eq("project_id", rule.project_id)
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

  const activeRules = (activeRulesRes.data ?? []) as SettlementRuleRow[];

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
          Editar {rule.launch_id ? "override" : "regla default"}
        </h1>
      </header>

      <RuleForm
        mode="edit"
        project={context}
        launches={launches}
        activeRules={activeRules}
        editingRule={rule}
        initialLaunchId={rule.launch_id}
        isOverrideNew={false}
      />
    </section>
  );
}
