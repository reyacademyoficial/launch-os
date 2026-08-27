import type { Metadata } from "next";
import Link from "next/link";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOrg } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { fCount } from "@/lib/finance/format";
import { listLaunchesForProject } from "@/lib/launches/list";
import { listProductsForProject } from "@/lib/products/list";
import { getKgProjects } from "@/lib/kg/reference";

import {
  createCommissionRule,
  createPaymentModality,
} from "./actions";
import { ComisionesView } from "./comisiones-view";

export const metadata: Metadata = { title: "Comisiones · Comercial" };

/**
 * Comisiones son MUY dependientes del proyecto (matriz product × modality).
 * Por eso el selector de proyecto vive en el URL (`?project=<uuid>`).
 *
 * Ahora todo el markup interior es KG (Panel, EmptyState, botones inline).
 * El pair rule-form + rule-modal y modality-form + modality-modal se
 * reemplazaron por drawers KG en `rule-form-drawer.tsx` y
 * `modality-form-drawer.tsx`. La lógica de validación de tiers/scope
 * quedó intacta.
 */
export default async function ComisionesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const projectId =
    typeof sp.project === "string" && sp.project.trim().length > 0
      ? sp.project
      : null;

  const projects = await getKgProjects();

  if (!projectId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ContextBar
          icon={<IconOrg size={16} />}
          title="Comisiones"
          stats={[
            { l: "Proyectos accesibles", v: fCount(projects.length) },
          ]}
        />
        <Panel title="Elegí un proyecto">
          {projects.length === 0 ? (
            <EmptyState
              title="No hay proyectos accesibles"
              hint="Necesitás al menos un proyecto para configurar comisiones."
            />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/comercial/comisiones?project=${p.id}`}
                  className="kg-focus"
                  style={{
                    padding: "12px 16px",
                    borderRadius: "var(--kg-r-8)",
                    background: "var(--kg-surface-2-solid)",
                    border: "1px solid var(--kg-border-subtle)",
                    color: "var(--kg-text-1)",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const selectedProject = projectById.get(projectId);
  if (!selectedProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ContextBar
          icon={<IconOrg size={16} />}
          title="Comisiones"
          stats={[]}
        />
        <Panel title="Proyecto no accesible">
          <EmptyState
            title="No podés ver este proyecto"
            hint="El proyecto elegido no existe o no tenés permisos."
          />
        </Panel>
      </div>
    );
  }

  const [modalities, rules, launches, products] = await Promise.all([
    listPaymentModalities(projectId),
    listCommissionRules(projectId),
    listLaunchesForProject(projectId),
    listProductsForProject(projectId),
  ]);

  const activeModalities = modalities.filter((m) => m.active);

  // Solo bindeamos las CREATE (una sola vez por proyecto). Las UPDATE se
  // bindean dentro de la ComisionesView usando `.bind()` sobre la referencia
  // directa a la server action — Next.js rechaza cruzar arrow functions
  // (closures no marcados `"use server"`) desde server a client, y una
  // función que retorna un bind es un closure. La view importa la action
  // directamente y bindea con el projectId + id al momento de editar.
  const createModalityAction = createPaymentModality.bind(null, projectId);
  const createRuleAction = createCommissionRule.bind(null, projectId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title="Comisiones"
        stats={[
          { l: "Modalidades activas", v: fCount(activeModalities.length) },
          { l: "Reglas configuradas", v: fCount(rules.length) },
        ]}
      />

      <ProjectSwitcher projects={projects} currentId={projectId} />

      <ComisionesView
        projectId={projectId}
        modalities={modalities}
        rules={rules}
        launches={launches.map((l) => ({ id: l.id, name: l.name }))}
        products={products}
        createModalityAction={createModalityAction}
        createRuleAction={createRuleAction}
      />
    </div>
  );
}

// ─── Selector de proyecto ────────────────────────────────────────────────

function ProjectSwitcher({
  projects,
  currentId,
}: {
  readonly projects: ReadonlyArray<{ id: string; name: string }>;
  readonly currentId: string;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        Proyecto
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {projects.map((p) => {
          const active = p.id === currentId;
          return (
            <Link
              key={p.id}
              href={`/comercial/comisiones?project=${p.id}`}
              className="kg-focus"
              aria-current={active ? "true" : undefined}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                background: active
                  ? "var(--kg-accent-500)"
                  : "var(--kg-surface-2-solid)",
                color: active ? "#fff" : "var(--kg-text-2)",
                border: active
                  ? "none"
                  : "1px solid var(--kg-border-subtle)",
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
