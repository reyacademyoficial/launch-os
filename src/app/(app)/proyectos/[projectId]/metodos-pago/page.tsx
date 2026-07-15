import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PaymentMethodDelete } from "@/components/dashboard/payment-methods/payment-method-delete";
import { PaymentMethodModal } from "@/components/dashboard/payment-methods/payment-method-modal";
import { listBanksForProject } from "@/lib/banks/list";
import { fmtMoney } from "@/lib/format";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { requireSessionProfile, userCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import {
  createPaymentMethod,
  deletePaymentMethod,
  updatePaymentMethod,
} from "./actions";

export const metadata: Metadata = { title: "Métodos de pago" };

/**
 * Página de catálogo de métodos de pago del proyecto (transferencia,
 * Stripe, efectivo…). Distinto de modalidad, que define la regla de
 * comisión. Un cobro sabe por qué método entró la plata — con eso
 * el admin ve la caja segmentada por medio.
 *
 * Admin-only (mismo criterio que /productos y /comisiones).
 */
export default async function PaymentMethodsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const profile = await requireSessionProfile();
  const canEdit = await userCanEditProject(projectId);
  if (!canEdit) redirect(`/proyectos/${projectId}`);
  void profile;

  const [methods, totals, banks] = await Promise.all([
    listPaymentMethods(projectId),
    aggregateAmountByMethod(projectId),
    listBanksForProject(projectId),
  ]);

  const createAction = createPaymentMethod.bind(null, projectId);
  const grandTotal = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  const unassigned = totals.get(UNASSIGNED_KEY) ?? 0;
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const banksForModal = banks.map((b) => ({
    id: b.id,
    name: b.name,
    active: b.active,
  }));

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Métodos de pago</h1>
        <p className="text-sm text-fg-muted">
          Por dónde entra la plata: transferencia, Stripe, efectivo, Mercado
          Pago… Se elige por cobro (no por venta). Distinto de{" "}
          <b>modalidad</b> (contado / N cuotas), que define la regla de
          comisión.
        </p>
      </header>

      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-fg">Catálogo</h2>
          <PaymentMethodModal
            triggerLabel="+ Nuevo método"
            triggerClassName="!px-3 !py-1.5 !text-xs"
            title="Nuevo método de pago"
            submitLabel="Crear"
            action={createAction}
            banks={banksForModal}
          />
        </header>
        {methods.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
            Sin métodos todavía. Cargá el primero para poder asignárselo a los
            cobros.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Nombre
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Banco destino
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Estado
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-medium"
                    title="Suma de todos los cobros que entraron por este método"
                  >
                    Ingresado
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {methods.map((m) => {
                  const updateAction = updatePaymentMethod.bind(
                    null,
                    projectId,
                    m.id,
                  );
                  const deleteAction = deletePaymentMethod.bind(
                    null,
                    projectId,
                    m.id,
                  );
                  const total = totals.get(m.id) ?? 0;
                  const bank = m.bank_id ? bankById.get(m.bank_id) : null;
                  return (
                    <tr key={m.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-fg">{m.name}</td>
                      <td className="px-4 py-3">
                        {bank ? (
                          <span className="text-fg-muted">
                            {bank.name}
                            {!bank.active ? " (inactivo)" : ""}
                          </span>
                        ) : (
                          <span className="text-warning">Sin banco</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.active ? (
                          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            Activo
                          </span>
                        ) : (
                          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-subtle">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {fmtMoney(total)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start justify-end gap-2">
                          <PaymentMethodModal
                            triggerLabel="Editar"
                            triggerVariant="secondary"
                            triggerClassName="!px-2 !py-1 !text-xs"
                            title={`Editar ${m.name}`}
                            submitLabel="Guardar"
                            action={updateAction}
                            initial={m}
                            banks={banksForModal}
                          />
                          <PaymentMethodDelete
                            name={m.name}
                            action={deleteAction}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {unassigned > 0 && (
                  <tr
                    className="border-t border-border bg-warning/5"
                    title="Cobros históricos sin método asignado. Editalos desde la ficha del alumno."
                  >
                    <td className="px-4 py-3 font-medium text-fg-muted">
                      Sin método asignado
                    </td>
                    <td className="px-4 py-3 text-fg-muted">—</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                        Pendiente de backfill
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                      {fmtMoney(unassigned)}
                    </td>
                    <td className="px-4 py-3" />
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
                <tr>
                  <td className="px-4 py-3 font-semibold text-fg" colSpan={3}>
                    Total ingresado
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-fg">
                    {fmtMoney(grandTotal)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

const UNASSIGNED_KEY = "__unassigned__";

/**
 * Suma de payments.amount por payment_method_id. Los cobros con method_id
 * NULL se agregan bajo `UNASSIGNED_KEY` para exponerlos en UI (bucket de
 * backfill pendiente).
 */
async function aggregateAmountByMethod(
  projectId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data: salesData } = await supabase
    .from("sales")
    .select("id")
    .eq("project_id", projectId);
  const saleIds = (salesData ?? []).map((s) => (s as { id: string }).id);
  const out = new Map<string, number>();
  if (saleIds.length === 0) return out;

  const { data: rows } = await supabase
    .from("payments")
    .select("amount, payment_method_id")
    .in("sale_id", saleIds);
  const payments = (rows ?? []) as Array<{
    amount: number;
    payment_method_id: string | null;
  }>;

  for (const p of payments) {
    const key = p.payment_method_id ?? UNASSIGNED_KEY;
    out.set(key, (out.get(key) ?? 0) + Number(p.amount));
  }
  return out;
}
