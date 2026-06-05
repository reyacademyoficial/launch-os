import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import type { Role } from "@/lib/supabase/auth";
import type { UserListItem } from "@/lib/users/list";

const ROLE_VARIANT: Record<Role, "info" | "warning" | "neutral"> = {
  superadmin: "info",
  admin: "warning",
  cliente: "neutral",
};

export function UserTable({ users }: { readonly users: readonly UserListItem[] }) {
  if (users.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
        Sin usuarios cargados todavía. Creá el primero con el botón de arriba.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[720px] text-sm">
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
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className="border-t border-border transition-colors hover:bg-surface"
            >
              <td className="px-4 py-3 font-medium text-fg">{u.email}</td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
