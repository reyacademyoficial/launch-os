import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { KanbanBoard } from "@/components/dashboard/leads/kanban-board";
import { LeadFormModal } from "@/components/dashboard/leads/lead-form-modal";
import {
  listCommissionRules,
  listPaymentModalities,
} from "@/lib/commissions/list";
import type { PaymentRow, SaleRow } from "@/lib/commissions/types";
import { listLaunchesForProject } from "@/lib/launches/list";
import { listLeads } from "@/lib/leads/list";
import {
  listPaymentsForProject,
  listSalesForProject,
} from "@/lib/sales/list";
import { requireSessionProfile, userCanEditLaunchesIn } from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

import {
  createLead,
  deleteLead,
  moveLeadStatus,
  updateLead,
} from "./actions";
import {
  addPayment,
  createSale,
  deletePayment,
} from "./sale-actions";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Cliente fuera del módulo CRM (decisión Fase 4). RLS también lo bloquea
  // en la DB; este redirect es UX.
  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect(`/proyectos/${projectId}`);

  const [leads, teamMembers, launches, canEdit, sales, payments, modalities, rules] =
    await Promise.all([
      listLeads(projectId),
      listTeamMembers(projectId),
      listLaunchesForProject(projectId),
      userCanEditLaunchesIn(projectId),
      listSalesForProject(projectId),
      listPaymentsForProject(projectId),
      listPaymentModalities(projectId),
      listCommissionRules(projectId),
    ]);

  const teamForForm = teamMembers.map((m) => ({
    id: m.id,
    name: m.name,
    active: m.active,
  }));
  const launchesForForm = launches.map((l) => ({ id: l.id, name: l.name }));

  // Maps lead → sale, sale → payments. Mantenemos refs simples para que el
  // cliente derive la comisión por card sin hacer un fetch extra.
  const salesByLeadId = new Map<string, SaleRow>(sales.map((s) => [s.lead_id, s]));
  const paymentsBySaleId = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const existing = paymentsBySaleId.get(p.sale_id);
    if (existing) existing.push(p);
    else paymentsBySaleId.set(p.sale_id, [p]);
  }

  // Server actions parcialmente bound al projectId. `.bind()` sobre una Server
  // Action produce otra Server Action serializable — el cliente puede pasarla
  // como prop y a su vez hacer `.bind(null, leadId)` por card.
  const createAction = createLead.bind(null, projectId);
  const moveAction = moveLeadStatus.bind(null, projectId);
  const updateAction = updateLead.bind(null, projectId);
  const deleteAction = deleteLead.bind(null, projectId);
  const createSaleAction = createSale.bind(null, projectId);
  const addPaymentAction = addPayment.bind(null, projectId);
  const deletePaymentAction = deletePayment.bind(null, projectId);

  const activeMembers = teamMembers.filter((m) => m.active).length;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="mt-1 text-xs text-fg-subtle">
            {leads.length} en pipeline ·{" "}
            <Link
              href={`/proyectos/${projectId}/equipo`}
              className="underline-offset-2 hover:underline"
            >
              {activeMembers} team members activos
            </Link>
          </p>
        </div>
        {canEdit && (
          <LeadFormModal
            triggerLabel="+ Nuevo lead"
            title="Nuevo lead"
            submitLabel="Crear"
            action={createAction}
            teamMembers={teamForForm}
            launches={launchesForForm}
          />
        )}
      </header>

      {leads.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="text-sm text-fg-muted">
            Sin leads cargados todavía
            {canEdit ? "." : ". Pedile al equipo que cargue el primero."}
          </p>
        </div>
      ) : (
        <KanbanBoard
          leads={leads}
          teamMembers={teamForForm}
          launches={launchesForForm}
          canEdit={canEdit}
          moveAction={moveAction}
          updateAction={updateAction}
          deleteAction={deleteAction}
          salesByLeadId={salesByLeadId}
          paymentsBySaleId={paymentsBySaleId}
          modalities={modalities}
          rules={rules}
          createSaleAction={createSaleAction}
          addPaymentAction={addPaymentAction}
          deletePaymentAction={deletePaymentAction}
        />
      )}
    </section>
  );
}
