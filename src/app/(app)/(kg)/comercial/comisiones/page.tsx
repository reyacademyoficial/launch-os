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
import { listAccessibleProjects } from "@/lib/projects/list";

import {
  createCommissionRule,
  createPaymentModality,
  deletePaymentModality,
  deleteCommissionRule,
  updateCommissionRule,
  updatePaymentModality,
} from "./actions";
import { ModalityModal } from "./modality-modal";
import { RowDelete } from "./row-delete";
import { RuleModal } from "./rule-modal";

export const metadata: Metadata = { title: "Comisiones · Comercial" };

/**
 * Comisiones son MUY dependientes del proyecto (matriz product × modality).
 * Por eso el selector de proyecto vive en el URL (`?project=<uuid>`) — no
 * mezclamos reglas de distintos proyectos en la misma tabla.
 *
 * Los componentes internos (modality/rule modals) son los mismos que en la
 * vista LaunchOS anterior: mismo comportamiento, misma validación. La
 * consistencia visual se pule en un bloque futuro dedicado si hace falta —
 * hoy la cara pública es KG (ContextBar) y el interior es Tailwind LaunchOS.
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

  const projects = await listAccessibleProjects();

  // Sin proyecto elegido → landing con selector.
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
    // Proyecto en URL pero fuera del alcance del usuario. RLS ya filtra —
    // esta rama solo pinta un mensaje comprensible.
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
            hint="El proyecto elegido no existe o no tenés permisos. Volvé al selector."
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

  const modalityById = new Map(modalities.map((m) => [m.id, m]));
  const launchById = new Map(launches.map((l) => [l.id, l.name]));
  const productById = new Map(products.map((p) => [p.id, p.name]));

  const createModalityAction = createPaymentModality.bind(null, projectId);
  const createRuleAction = createCommissionRule.bind(null, projectId);

  const activeModalities = modalities.filter((m) => m.active);

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

      <Panel title={`Modalidades de pago · ${selectedProject.name}`}>
        <div className="space-y-3">
          <header className="flex items-baseline justify-between gap-4">
            <p className="text-xs text-fg-muted">
              Modalidades de pago disponibles al cargar una venta (contado,
              cuotas, etc.).
            </p>
            <ModalityModal
              triggerLabel="+ Nueva modalidad"
              triggerClassName="!px-3 !py-1.5 !text-xs"
              title="Nueva modalidad"
              submitLabel="Crear"
              action={createModalityAction}
            />
          </header>
          {modalities.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
              Sin modalidades. Cargá la primera (ej. &ldquo;Pago total&rdquo; o
              &ldquo;3 cuotas&rdquo;).
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
                    <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {modalities.map((m) => {
                    const updateAction = updatePaymentModality.bind(null, projectId, m.id);
                    const deleteAction = deletePaymentModality.bind(null, projectId, m.id);
                    return (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium text-fg">{m.name}</td>
                        <td className="px-4 py-3">
                          {m.active ? (
                            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                              Activa
                            </span>
                          ) : (
                            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-subtle">
                              Inactiva
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <ModalityModal
                              triggerLabel="Editar"
                              triggerVariant="secondary"
                              triggerClassName="!px-2 !py-1 !text-xs"
                              title={`Editar ${m.name}`}
                              submitLabel="Guardar"
                              action={updateAction}
                              initial={m}
                            />
                            <RowDelete
                              confirmLabel={`¿Borrar "${m.name}"? Las reglas que la usan también se borran.`}
                              action={deleteAction}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      <Panel title={`Reglas de comisión · ${selectedProject.name}`}>
        <div className="space-y-3">
          <header className="flex items-baseline justify-between gap-4">
            <p className="text-xs text-fg-muted">
              Cada regla puede aplicar a una o más modalidades, tiene tramos
              por cantidad de ventas, y un modo de devengamiento (proporcional
              o con umbral).
            </p>
            {activeModalities.length > 0 && (
              <RuleModal
                triggerLabel="+ Nueva regla"
                triggerClassName="!px-3 !py-1.5 !text-xs"
                action={createRuleAction}
                modalities={modalities}
                launches={launches.map((l) => ({ id: l.id, name: l.name }))}
                products={products}
              />
            )}
          </header>
          {activeModalities.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
              Necesitás al menos una modalidad activa antes de crear reglas.
            </p>
          ) : rules.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
              Sin reglas. Las ventas calculan comisión = 0 hasta que cargues la
              primera para esa modalidad.
            </p>
          ) : (
            <div className="space-y-3">
              {rules.map((r) => {
                const modalityNames = r.modality_ids
                  .map((id) => modalityById.get(id)?.name ?? "—")
                  .join(", ");
                const scopeLabel = r.product_id
                  ? `Producto: ${productById.get(r.product_id) ?? "—"}`
                  : r.launch_id
                    ? `Launch: ${launchById.get(r.launch_id) ?? "—"}`
                    : "Default del proyecto";
                const deleteAction = deleteCommissionRule.bind(null, projectId, r.id);
                const updateAction = updateCommissionRule.bind(null, projectId, r.id);
                return (
                  <article
                    key={r.id}
                    className="overflow-hidden rounded-md border border-border"
                  >
                    <header className="flex items-start justify-between gap-4 border-b border-border bg-surface px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-fg">
                          {modalityNames || "Sin modalidades"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                          <span>{scopeLabel}</span>
                          <span>·</span>
                          <span>{accrualLabel(r)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <RuleModal
                          triggerLabel="Editar"
                          triggerVariant="secondary"
                          triggerClassName="!px-2 !py-1 !text-xs"
                          title="Editar regla de comisión"
                          submitLabel="Guardar"
                          action={updateAction}
                          modalities={modalities}
                          launches={launches.map((l) => ({ id: l.id, name: l.name }))}
                          products={products}
                          initial={{
                            modality_ids: r.modality_ids,
                            launch_id: r.launch_id,
                            product_id: r.product_id,
                            accrual_mode: r.accrual_mode,
                            threshold_type: r.threshold_type,
                            threshold_value: r.threshold_value,
                            tiers: r.tiers.map((t) => ({
                              min_count: t.min_count,
                              max_count: t.max_count,
                              type: t.type,
                              value: t.value,
                            })),
                          }}
                        />
                        <RowDelete
                          confirmLabel="¿Borrar esta regla?"
                          action={deleteAction}
                        />
                      </div>
                    </header>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-fg-subtle">
                          <tr>
                            <th scope="col" className="px-4 py-2 font-medium">Tramo</th>
                            <th scope="col" className="px-4 py-2 font-medium">Desde</th>
                            <th scope="col" className="px-4 py-2 font-medium">Hasta</th>
                            <th scope="col" className="px-4 py-2 font-medium">Tipo</th>
                            <th scope="col" className="px-4 py-2 text-right font-medium">
                              Valor
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.tiers.map((t, i) => (
                            <tr key={t.id} className="border-t border-border">
                              <td className="px-4 py-2 text-fg-muted">#{i + 1}</td>
                              <td className="px-4 py-2 tabular-nums">
                                venta {t.min_count + 1}
                              </td>
                              <td className="px-4 py-2 tabular-nums">
                                {t.max_count === null ? "∞" : `venta ${t.max_count + 1}`}
                              </td>
                              <td className="px-4 py-2 text-fg-muted">
                                {t.type === "percent" ? "%" : "$ fijo"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-fg">
                                {t.type === "percent" ? `${t.value}%` : `$${t.value}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

// ─── Sub-componente: selector de proyecto activo ─────────────────────────

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
      <span
        className="kg-t7"
        style={{ color: "var(--kg-text-3)" }}
      >
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

function accrualLabel(r: {
  accrual_mode:
    | "proportional"
    | "threshold_full"
    | "threshold_proportional"
    | "on_close";
  threshold_type: "payment_count" | "paid_ratio" | null;
  threshold_value: number | null;
}): string {
  if (r.accrual_mode === "on_close") return "Se libera al cerrar la venta";
  if (r.accrual_mode === "proportional") return "A medida que entra plata";
  const cond =
    r.threshold_type === "payment_count"
      ? `${r.threshold_value} cobros`
      : `${Math.round((r.threshold_value ?? 0) * 100)}% cobrado`;
  if (r.accrual_mode === "threshold_full") {
    return `Al juntar ${cond} → paga el total`;
  }
  return `Al juntar ${cond} → proporcional al cobrado`;
}
