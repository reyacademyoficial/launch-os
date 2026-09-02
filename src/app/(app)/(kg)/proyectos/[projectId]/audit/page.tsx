import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconLaunch } from "@/components/kg/icons";
import { canViewAuditLog } from "@/lib/auth/permissions";
import { listAuditLog } from "@/lib/audit/list";
import { fCount } from "@/lib/finance/format";
import { requireSessionProfile } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<{ page?: string }>;
}) {
  const { projectId } = await params;
  // Operador y cliente NO ven audit log. La RLS de 0009 ya devuelve vacío para
  // ellos, pero gateamos también acá para evitar mostrar la página vacía y
  // dejarla esquinada del UI.
  const profile = await requireSessionProfile();
  if (!canViewAuditLog(profile, projectId)) {
    redirect(`/proyectos/${projectId}`);
  }
  const { page: pageStr } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageStr ?? "0", 10) || 0);

  const { rows, total } = await listAuditLog(projectId, page, PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Audit log"
        stats={[
          { l: "Registros", v: fCount(total) },
          { l: "En esta página", v: fCount(rows.length) },
          // La paginación vive al pie de la tabla; repetirla arriba evita
          // scrollear hasta el fondo para saber dónde estás parado.
          { l: "Página", v: `${page + 1} / ${lastPage + 1}` },
        ]}
      />

      {/*
        El "solo lectura" sobrevive al header borrado: es la única parte que el
        ContextBar no cubre, y es lo que explica por qué la tabla no tiene
        acciones.
      */}
      <p className="text-xs text-fg-subtle">Solo lectura</p>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          Sin actividad registrada.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Usuario
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Acción
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Detalle
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border align-top transition-colors hover:bg-surface"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                      {new Date(r.ts).toLocaleString("es-AR")}
                    </td>
                    <td className="px-3 py-2 text-fg">
                      {r.user_name ?? r.user_id ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-medium text-fg">{r.action}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      <DetailCell detail={r.detail} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastPage > 0 && (
            <nav className="flex items-center justify-between text-xs text-fg-muted">
              <div>
                Página {page + 1} de {lastPage + 1}
              </div>
              <div className="flex gap-2">
                {page > 0 && (
                  <Link
                    href={`/proyectos/${projectId}/audit?page=${page - 1}`}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-fg hover:bg-bg-elevated"
                  >
                    ← Anterior
                  </Link>
                )}
                {page < lastPage && (
                  <Link
                    href={`/proyectos/${projectId}/audit?page=${page + 1}`}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-fg hover:bg-bg-elevated"
                  >
                    Siguiente →
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function DetailCell({ detail }: { readonly detail: unknown }) {
  if (detail === null || detail === undefined) return <span>—</span>;
  if (typeof detail === "object") {
    const json = JSON.stringify(detail);
    if (json === "{}" || json === "[]") return <span>—</span>;
    return <code className="break-all">{json}</code>;
  }
  return <span>{String(detail)}</span>;
}
