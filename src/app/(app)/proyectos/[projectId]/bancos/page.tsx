import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BanksView } from "@/components/dashboard/banks/banks-view";
import { computeBankBalances } from "@/lib/banks/balance";
import {
  listBankMovementsForProject,
  listBanksForProject,
} from "@/lib/banks/list";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { requireSessionProfile, userCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import {
  createBank,
  createBankMovement,
  deleteBank,
  deleteBankMovement,
  updateBank,
  updateBankMovement,
} from "./actions";

export const metadata: Metadata = { title: "Bancos" };

/**
 * Página de Bancos (Fase 12). Admin-only, mismo criterio que Métodos de pago
 * y Productos: la decisión de cómo se aloja la plata es estructural del
 * proyecto. RLS igual bloquea escrituras a operadores; el redirect evita
 * dejar una página vacía visible.
 */
export default async function BanksPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const profile = await requireSessionProfile();
  const canEdit = await userCanEditProject(projectId);
  if (!canEdit) redirect(`/proyectos/${projectId}`);
  void profile;

  const supabase = await createClient();

  const [banks, paymentMethods, movements] = await Promise.all([
    listBanksForProject(projectId),
    listPaymentMethods(projectId),
    listBankMovementsForProject(projectId),
  ]);

  // Cobros del proyecto (solo amount + method_id) — necesarios para agregar
  // por banco vía payment_methods.bank_id. Se traen todas las sales del
  // proyecto y después sus payments. Bug potencial de paginación: para
  // proyectos con >1000 payments la query cortaría; si aparece, mover a
  // aggregate SQL con view. Por ahora aceptable.
  const { data: salesData } = await supabase
    .from("sales")
    .select("id")
    .eq("project_id", projectId);
  const saleIds = ((salesData ?? []) as Array<{ id: string }>).map((s) => s.id);
  const payments: Array<{
    amount: number;
    payment_method_id: string | null;
  }> = [];
  if (saleIds.length > 0) {
    const { data } = await supabase
      .from("payments")
      .select("amount, payment_method_id")
      .in("sale_id", saleIds);
    payments.push(
      ...((data ?? []) as Array<{
        amount: number;
        payment_method_id: string | null;
      }>),
    );
  }

  const balances = computeBankBalances(
    banks,
    paymentMethods,
    payments,
    movements,
  );

  // Todas las server actions tienen `projectId` como primer parámetro para
  // poder curryarlas con `.bind(null, projectId)` — arrow functions inline
  // NO son serializables cross-boundary y Next 16 tira runtime error.
  const createBankAction = createBank.bind(null, projectId);
  const updateBankAction = updateBank.bind(null, projectId);
  const deleteBankAction = deleteBank.bind(null, projectId);
  const createMovementAction = createBankMovement.bind(null, projectId);
  const updateMovementAction = updateBankMovement.bind(null, projectId);
  const deleteMovementAction = deleteBankMovement.bind(null, projectId);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Bancos</h1>
        <p className="text-sm text-fg-muted">
          Cuentas donde va a parar la plata. Cada método de pago se asigna a
          un banco desde <b>Métodos de pago</b>. El saldo se calcula en
          runtime — cobrar/borrar una venta o un movimiento lo actualiza sin
          intervención manual.
        </p>
      </header>

      <BanksView
        banks={banks}
        balances={balances}
        paymentMethods={paymentMethods}
        movements={movements}
        canEdit={canEdit}
        createBankAction={createBankAction}
        updateBankAction={updateBankAction}
        deleteBankAction={deleteBankAction}
        createMovementAction={createMovementAction}
        updateMovementAction={updateMovementAction}
        deleteMovementAction={deleteMovementAction}
      />
    </section>
  );
}
