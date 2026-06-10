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
  deleteCommissionRule,
  deletePaymentModality,
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
  // Hint para TS de que el role del profile fue consumido (evita warning).
  void profile;

  return (
    <section className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Comisiones</h1>
        <p className="text-sm text-fg-muted">
          Configurá las modalidades de pago y la regla de comisión por
          modalidad. La comisión se calcula sobre lo <b>cobrado</b>, no sobre
          lo pactado.
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
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Modalidad</th>
                  <th scope="col" className="px-4 py-3 font-medium">Lanzamiento</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tipo</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Valor
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const deleteAction = deleteCommissionRule.bind(null, projectId, r.id);
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-3 text-fg">
                        {modalityById.get(r.payment_modality_id)?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {r.launch_id ? launchById.get(r.launch_id) ?? "—" : "Default"}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {r.type === "percent" ? "% cobrado" : "Fijo proporcional"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {r.type === "percent" ? `${r.value}%` : `$${r.value}`}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowDelete
                            confirmLabel="¿Borrar esta regla?"
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
    </section>
  );
}
