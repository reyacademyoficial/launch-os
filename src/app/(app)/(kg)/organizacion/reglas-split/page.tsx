import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fMoney, fPct } from "@/lib/finance/format";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  SettlementAppliesOn,
  SettlementRuleRow,
} from "@/lib/settlements/types";

export const metadata: Metadata = { title: "Reglas de split" };

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
}

interface LaunchNameRow {
  readonly id: string;
  readonly name: string | null;
}

export default async function ReglasSplitPage() {
  await requireRole("superadmin");

  const supabase = await createClient();
  const [projectsRes, rulesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, ownership")
      .order("name", { ascending: true }),
    supabase
      .from("settlement_rules")
      .select(
        "id, organization_id, project_id, launch_id, name, percent_of_collected, fixed_fee_per_launch, fixed_fee_per_sale, min_guarantee, applies_on, active, created_at, updated_at, created_by",
      )
      .eq("active", true),
  ]);

  const projects = (projectsRes.data ?? []) as ProjectRow[];
  const rules = (rulesRes.data ?? []) as SettlementRuleRow[];

  const overrideLaunchIds = Array.from(
    new Set(rules.filter((r) => r.launch_id != null).map((r) => r.launch_id!)),
  );
  let launchNameById = new Map<string, string>();
  if (overrideLaunchIds.length > 0) {
    const launchesRes = await supabase
      .from("launches")
      .select("id, name")
      .in("id", overrideLaunchIds);
    const launchRows = (launchesRes.data ?? []) as LaunchNameRow[];
    launchNameById = new Map(
      launchRows.map((l) => [
        l.id,
        l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`,
      ]),
    );
  }

  const rulesByProject = new Map<string, SettlementRuleRow[]>();
  for (const r of rules) {
    const list = rulesByProject.get(r.project_id) ?? [];
    list.push(r);
    rulesByProject.set(r.project_id, list);
  }

  const unconfiguredCount = projects.filter(
    (p) => !rulesByProject.get(p.id)?.some((r) => r.launch_id === null),
  ).length;

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Reglas de split</h1>
        <p className="mt-1 text-xs text-fg-subtle">
          {projects.length} proyecto{projects.length === 1 ? "" : "s"} ·{" "}
          {unconfiguredCount} sin regla default
        </p>
        <p className="mt-2 max-w-3xl text-xs text-fg-muted">
          El orquestador resuelve la regla vigente para un lanzamiento en dos
          pasos: primero busca una regla activa con ese <code>launch_id</code>{" "}
          específico (override); si no la encuentra, usa la default del proyecto
          (regla con <code>launch_id</code> vacío). Esta vista muestra ambas
          para que el override no quede oculto detrás de la default.
        </p>
      </header>

      {projects.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          No hay proyectos cargados todavía.
        </p>
      )}

      <div className="space-y-4">
        {projects.map((project) => {
          const projectRules = rulesByProject.get(project.id) ?? [];
          const defaultRule = projectRules.find((r) => r.launch_id === null);
          const overrides = projectRules
            .filter((r) => r.launch_id != null)
            .sort((a, b) => {
              const nameA = launchNameById.get(a.launch_id!) ?? "";
              const nameB = launchNameById.get(b.launch_id!) ?? "";
              return nameA.localeCompare(nameB);
            });

          return (
            <ProjectCard
              key={project.id}
              project={project}
              defaultRule={defaultRule ?? null}
              overrides={overrides}
              launchNameById={launchNameById}
            />
          );
        })}
      </div>
    </section>
  );
}

function ProjectCard({
  project,
  defaultRule,
  overrides,
  launchNameById,
}: {
  readonly project: ProjectRow;
  readonly defaultRule: SettlementRuleRow | null;
  readonly overrides: readonly SettlementRuleRow[];
  readonly launchNameById: ReadonlyMap<string, string>;
}) {
  return (
    <article className="rounded-md border border-border bg-surface p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-fg">{project.name}</h2>
          <span
            title="Ownership del proyecto — hoy es solo contexto informativo, no lo usa el cálculo"
          >
            <Badge variant={project.ownership === "propia" ? "info" : "neutral"}>
              {project.ownership}
            </Badge>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {defaultRule ? (
            <Link
              href={`/organizacion/reglas-split/${defaultRule.id}/edit`}
              className="text-xs font-medium text-fg-muted hover:text-fg"
            >
              Editar default
            </Link>
          ) : (
            <Link href={`/organizacion/reglas-split/new?projectId=${project.id}`}>
              <Button type="button">+ Regla default</Button>
            </Link>
          )}
          <Link
            href={`/organizacion/reglas-split/new?projectId=${project.id}&scope=override`}
            className="text-xs font-medium text-fg-muted hover:text-fg"
          >
            + Override por lanzamiento
          </Link>
        </div>
      </header>

      {!defaultRule && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-fg">
          <strong>Sin configurar.</strong> Este proyecto no tiene regla default
          y sus lanzamientos no se pueden liquidar hasta que exista una regla
          (default o específica por launch).
        </div>
      )}

      {defaultRule && (
        <RuleRow
          label="Default del proyecto"
          rule={defaultRule}
          launchName={null}
        />
      )}

      {overrides.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">
            Overrides por lanzamiento ({overrides.length})
          </div>
          <div className="space-y-2">
            {overrides.map((r) => (
              <RuleRow
                key={r.id}
                label={launchNameById.get(r.launch_id!) ?? "Lanzamiento"}
                rule={r}
                launchName={launchNameById.get(r.launch_id!) ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Fila resumen de una regla. Muestra el "shape" completo — todos los
 * componentes visibles aunque estén en cero — para que quien lee no tenga
 * que asumir qué implica que un campo falte.
 */
function RuleRow({
  label,
  rule,
  launchName: _launchName,
}: {
  readonly label: string;
  readonly rule: SettlementRuleRow;
  readonly launchName: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-fg">{label}</div>
          <div className="text-xs text-fg-subtle">{rule.name}</div>
        </div>
        <Link
          href={`/organizacion/reglas-split/${rule.id}/edit`}
          className="text-xs font-medium text-fg-muted hover:text-fg"
        >
          Editar
        </Link>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-5">
        <RuleStat label="Base" value={appliesOnLabel(rule.applies_on)} />
        <RuleStat
          label="% sobre base"
          value={fPct(rule.percent_of_collected / 100)}
        />
        <RuleStat
          label="Fijo por liquidación"
          value={fMoney(rule.fixed_fee_per_launch)}
          dim={rule.fixed_fee_per_launch === 0}
        />
        <RuleStat
          label="Fijo por venta"
          value={fMoney(rule.fixed_fee_per_sale)}
          dim={rule.fixed_fee_per_sale === 0}
        />
        <RuleStat
          label="Garantía mín."
          value={rule.min_guarantee != null ? fMoney(rule.min_guarantee) : "—"}
          dim={rule.min_guarantee == null}
        />
      </dl>
    </div>
  );
}

function RuleStat({
  label,
  value,
  dim,
}: {
  readonly label: string;
  readonly value: string;
  readonly dim?: boolean;
}) {
  return (
    <div>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={dim ? "text-fg-subtle" : "text-fg"}>{value}</dd>
    </div>
  );
}

function appliesOnLabel(v: SettlementAppliesOn): string {
  return v === "collected" ? "cobrado" : "vendido";
}
