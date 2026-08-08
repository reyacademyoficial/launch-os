import {
  deactivateUser,
  reactivateUser,
} from "@/app/(admin)/admin/usuarios/actions";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import type { Role } from "@/lib/supabase/auth";
import type { UserListItem } from "@/lib/users/list";

import { DeactivateUserButton } from "./deactivate-user-button";
import { EditUserModal } from "./edit-user-modal";
import { ReactivateUserButton } from "./reactivate-user-button";

const ROLE_VARIANT: Record<Role, "info" | "warning" | "success" | "neutral"> = {
  // 'dev' es invisible: listAllUsers ya filtra estas filas. La key existe
  // sólo para satisfacer el type, nunca se renderiza.
  dev: "neutral",
  superadmin: "info",
  admin: "warning",
  operador: "success",
  coordinador: "info",
  cliente: "neutral",
};

interface Project {
  id: string;
  name: string;
}

export function UserTable({
  users,
  projects,
  currentUserId,
}: {
  readonly users: readonly UserListItem[];
  readonly projects: readonly Project[];
  readonly currentUserId: string;
}) {
  if (users.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
        Sin usuarios cargados todavía. Creá el primero con el botón de arriba.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Email
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Nombre
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Rol
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Proyectos
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Alta
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const isInactive = u.deletedAt !== null;
            const editableUser = {
              id: u.id,
              email: u.email,
              fullName: u.fullName,
              role: u.role,
              currentProjectIds: u.projects.map((p) => p.id),
            };
            const deactivateAction = deactivateUser.bind(null, u.id);
            const reactivateAction = reactivateUser.bind(null, u.id);

            return (
              <tr
                key={u.id}
                className={`border-t border-border transition-colors hover:bg-surface ${
                  isInactive ? "opacity-60" : ""
                }`}
              >
                <td className="px-4 py-3 font-medium text-fg">
                  <div className="flex items-center gap-2">
                    <span>{u.email}</span>
                    {isInactive && <Badge variant="neutral">inactivo</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 text-fg-muted">{u.fullName ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant={ROLE_VARIANT[u.role]}>{u.role}</Badge>
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {u.projects.length === 0 ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {u.projects.map((p) => (
                        <span
                          key={p.id}
                          className="rounded bg-surface px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-fg-muted">
                  {fmtDate(u.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  {isSelf ? (
                    <span className="text-xs text-fg-subtle">vos</span>
                  ) : isInactive ? (
                    <ReactivateUserButton onConfirm={reactivateAction} />
                  ) : (
                    <div className="inline-flex items-center gap-4">
                      <EditUserModal user={editableUser} projects={projects} />
                      <DeactivateUserButton onConfirm={deactivateAction} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
