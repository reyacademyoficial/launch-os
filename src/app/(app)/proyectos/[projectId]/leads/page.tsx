import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { KanbanBoard } from "@/components/dashboard/leads/kanban-board";
import { LeadFormModal } from "@/components/dashboard/leads/lead-form-modal";
import { listLaunchesForProject } from "@/lib/launches/list";
import { listLeads } from "@/lib/leads/list";
import type { LeadStatus } from "@/lib/leads/types";
import { requireSessionProfile, userCanEditLaunchesIn } from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";

import {
  createLead,
  deleteLead,
  moveLeadStatus,
  updateLead,
} from "./actions";

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

  const [leads, teamMembers, launches, canEdit] = await Promise.all([
    listLeads(projectId),
    listTeamMembers(projectId),
    listLaunchesForProject(projectId),
    userCanEditLaunchesIn(projectId),
  ]);

  const teamForForm = teamMembers.map((m) => ({
    id: m.id,
    name: m.name,
    active: m.active,
  }));
  const launchesForForm = launches.map((l) => ({ id: l.id, name: l.name }));

  const createAction = createLead.bind(null, projectId);
  const move = async (leadId: string, status: LeadStatus) =>
    moveLeadStatus(projectId, leadId, status);
  const updateActionFor = (leadId: string) => updateLead.bind(null, projectId, leadId);
  const deleteActionFor = (leadId: string) => deleteLead.bind(null, projectId, leadId);

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
          moveAction={move}
          updateActionFor={updateActionFor}
          deleteActionFor={deleteActionFor}
        />
      )}
    </section>
  );
}
