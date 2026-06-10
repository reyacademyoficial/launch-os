import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TeamMemberModal } from "@/components/dashboard/team/team-member-modal";
import { TeamRowActions } from "@/components/dashboard/team/team-row-actions";
import { requireSessionProfile, userCanEditLaunchesIn } from "@/lib/supabase/auth";
import { listTeamMembers } from "@/lib/team/list";
import type { TeamMemberRole } from "@/lib/team/types";

import {
  createTeamMember,
  deleteTeamMember,
  updateTeamMember,
} from "./actions";

export const metadata: Metadata = { title: "Equipo" };

const ROLE_LABELS: Record<TeamMemberRole, string> = {
  setter: "Setter",
  closer: "Closer",
  media_buyer: "Media buyer",
  manager: "Manager",
  otro: "Otro",
};

export default async function TeamPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Cliente queda fuera del módulo CRM (decisión Fase 4). RLS igualmente filtra
  // todo, pero bouncearlo evita renderizar una página vacía sin contexto.
  const profile = await requireSessionProfile();
  if (profile.role === "cliente") redirect(`/proyectos/${projectId}`);

  const [members, canEdit] = await Promise.all([
    listTeamMembers(projectId),
    userCanEditLaunchesIn(projectId),
  ]);

  const createAction = createTeamMember.bind(null, projectId);

  if (members.length === 0) {
    return (
      <section className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Equipo</h1>
        <p className="text-sm text-fg-muted">
          Sin team members cargados todavía
          {canEdit ? "." : ". Pedile al admin que cargue al equipo."}
        </p>
        {canEdit && (
          <TeamMemberModal
            triggerLabel="+ Cargar primer team member"
            title="Nuevo team member"
            submitLabel="Crear"
            action={createAction}
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Equipo</h1>
          <p className="mt-1 text-xs text-fg-subtle">
            {members.length} total ·{" "}
            {members.filter((m) => m.active).length} activos
          </p>
        </div>
        {canEdit && (
          <TeamMemberModal
            triggerLabel="+ Nuevo team member"
            title="Nuevo team member"
            submitLabel="Crear"
            action={createAction}
          />
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
              <th scope="col" className="px-4 py-3 font-medium">Rol</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                % comisión
              </th>
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              {canEdit && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const updateAction = updateTeamMember.bind(null, projectId, m.id);
              const deleteAction = deleteTeamMember.bind(null, projectId, m.id);
              return (
                <tr
                  key={m.id}
                  className="border-t border-border transition-colors hover:bg-surface"
                >
                  <td className="px-4 py-3 font-medium text-fg">{m.name}</td>
                  <td className="px-4 py-3 text-fg-muted">{ROLE_LABELS[m.role]}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                    {typeof m.commission_rate === "number"
                      ? `${m.commission_rate}%`
                      : "—"}
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
                  {canEdit && (
                    <td className="px-4 py-3">
                      <TeamRowActions
                        member={m}
                        updateAction={updateAction}
                        deleteAction={deleteAction}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
