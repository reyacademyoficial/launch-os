import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";

import { EditPersonModal } from "./edit-person-modal";
import { PersonActiveToggle } from "./person-active-toggle";

export interface PersonRow {
  readonly id: string;
  readonly full_name: string;
  readonly national_id: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  readonly created_at: string;
  readonly monthly_salary: number;
  readonly salary_currency: "ARS" | "USD";
  /** Usuario Kingrow vinculado. `null` = persona sin usuario (freelance, etc). */
  readonly auth_user_id: string | null;
}

/** Subset de UserListItem que el dropdown de vinculación necesita. */
export interface AssignableUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
}

export function PersonasTable({
  rows,
  showingFilter,
  assignableUsers,
}: {
  readonly rows: readonly PersonRow[];
  readonly showingFilter: "active" | "inactive" | "all";
  readonly assignableUsers: readonly AssignableUser[];
}) {
  if (rows.length === 0) {
    const message =
      showingFilter === "active"
        ? "No hay personas activas todavía. Creá la primera con el botón de arriba — la nómina, el control de tiempo y las asignaciones operativas dependen de esta tabla."
        : showingFilter === "inactive"
          ? "Sin personas inactivas."
          : "Sin personas cargadas todavía.";
    return (
      <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
        {message}
      </p>
    );
  }

  const userById = new Map<string, AssignableUser>();
  for (const u of assignableUsers) userById.set(u.id, u);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Nombre
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Documento
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Contacto
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Usuario
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Sueldo
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Estado
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
          {rows.map((p) => (
            <tr
              key={p.id}
              className={
                "border-t border-border transition-colors hover:bg-surface " +
                (p.active ? "" : "opacity-60")
              }
            >
              <td className="px-4 py-3 font-medium text-fg">
                {p.full_name}
                {p.notes && (
                  <p className="mt-0.5 text-xs text-fg-subtle">{p.notes}</p>
                )}
              </td>
              <td className="px-4 py-3 text-fg-muted">
                {p.national_id ?? <span className="text-fg-subtle">—</span>}
              </td>
              <td className="px-4 py-3 text-fg-muted">
                {p.email || p.phone ? (
                  <div className="space-y-0.5">
                    {p.email && <div className="text-xs">{p.email}</div>}
                    {p.phone && (
                      <div className="text-xs text-fg-subtle">{p.phone}</div>
                    )}
                  </div>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-fg-muted">
                {p.auth_user_id ? (
                  (() => {
                    const u = userById.get(p.auth_user_id);
                    if (!u) {
                      // Persona vinculada a un user que hoy no está en la
                      // lista asignable (rol cliente, dev, o soft-deleted).
                      return (
                        <span className="text-xs text-fg-subtle italic">
                          Vinculada
                        </span>
                      );
                    }
                    return (
                      <div className="space-y-0.5">
                        <div className="text-xs">{u.email}</div>
                        {u.fullName && (
                          <div className="text-xs text-fg-subtle">
                            {u.fullName}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <span className="text-fg-subtle">Sin usuario</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                {p.monthly_salary > 0 ? (
                  <span>
                    {p.salary_currency === "USD" ? "US$" : "AR$"}{" "}
                    {new Intl.NumberFormat("es-AR", {
                      maximumFractionDigits: 0,
                    }).format(p.monthly_salary)}
                  </span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge variant={p.active ? "success" : "neutral"}>
                  {p.active ? "activa" : "inactiva"}
                </Badge>
              </td>
              <td className="px-4 py-3 text-xs text-fg-muted">
                {fmtDate(p.created_at)}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center gap-4">
                  <EditPersonModal
                    person={p}
                    assignableUsers={assignableUsers}
                  />
                  <PersonActiveToggle personId={p.id} active={p.active} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
