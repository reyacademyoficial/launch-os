import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ModalityModal } from "@/components/dashboard/commissions/modality-modal";
import { RowDelete } from "@/components/dashboard/commissions/row-delete";
import { RuleModal } from "@/components/dashboard/commissions/rule-modal";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import { listLaunchesForProject } from "@/lib/launches/list";
import { requireSessionProfile, userCanEditProject } from "@/lib/supabase/auth";

import {
  createCommissionRule,
  createPaymentModality,
  deletePaymentModality,
  deleteCommissionRule,
  updatePaymentModality,
} from "./actions";

export const metadata: Metadata = { title: "Comisiones" };

export default async function CommissionsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Admin-only. Operador, analista, cliente no entran. RLS bloquea writes
  // igualmente, pero la página redirige para no mostrar contenido vacío.
  const profile = await requireSessionProfile();
  const canEdit = await userCanEditProject(projectId);
  if (!canEdit) redirect(`/proyectos/${projectId}`);

  const [modalities, rules, launches] = await Promise.all([
    listPaymentModalities(projectId),
    listCommissionRules(projectId),
    listLaunchesForProject(projectId),
  ]);

  const modalityById = new Map(modalities.map((m) => [m.id, m]));
  const launchById = new Map(launches.map((l) => [l.id, l.name]));

  const createModalityAction = createPaymentModality.bind(null, projectId);
  const createRuleAction = createCommissionRule.bind(null, projectId);
  void profile;

  return (
    <section className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Comisiones</h1>
        <p className="text-sm text-fg-muted">
          Configurá las modalidades de pago y las reglas escalonadas. Cada regla
          puede aplicar a una o más modalidades, tiene tramos por cantidad de
          ventas, y un modo de devengamiento (proporcional o con umbral).
        </p>
      </header>

      {/* ─── Modalidades ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-fg">Modalidades de pago</h2>
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
            Sin modalidades. Cargá la primera (ej. &ldquo;Pago total&rdquo; o &ldquo;3 cuotas&rdquo;).
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
      </section>

      {/* ─── Reglas ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-fg">Reglas de comisión</h2>
          {modalities.filter((m) => m.active).length > 0 && (
            <RuleModal
              triggerLabel="+ Nueva regla"
              triggerClassName="!px-3 !py-1.5 !text-xs"
              action={createRuleAction}
              modalities={modalities}
              launches={launches.map((l) => ({ id: l.id, name: l.name }))}
            />
          )}
        </header>
        {modalities.filter((m) => m.active).length === 0 ? (
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
              const launchLabel = r.launch_id
                ? launchById.get(r.launch_id) ?? "—"
                : "Default del proyecto";
              const deleteAction = deleteCommissionRule.bind(null, projectId, r.id);
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
                        <span>{launchLabel}</span>
                        <span>·</span>
                        <span>{accrualLabel(r)}</span>
                      </div>
                    </div>
                    <RowDelete
                      confirmLabel="¿Borrar esta regla?"
                      action={deleteAction}
                    />
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
      </section>
    </section>
  );
}

function accrualLabel(r: {
  accrual_mode: "proportional" | "threshold_full" | "threshold_proportional";
  threshold_type: "payment_count" | "paid_ratio" | null;
  threshold_value: number | null;
}): string {
  if (r.accrual_mode === "proportional") return "Proporcional al cobrado";
  const cond =
    r.threshold_type === "payment_count"
      ? `${r.threshold_value} cobros`
      : `${Math.round((r.threshold_value ?? 0) * 100)}% cobrado`;
  if (r.accrual_mode === "threshold_full") {
    return `Libera al cumplir ${cond} → sobre el total`;
  }
  return `Libera al cumplir ${cond} → proporcional`;
}
