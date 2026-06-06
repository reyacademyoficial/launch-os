import type { Metadata } from "next";
import Link from "next/link";

import { listAuditLog } from "@/lib/audit/list";

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
  const { page: pageStr } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageStr ?? "0", 10) || 0);

  const { rows, total } = await listAuditLog(projectId, page, PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="mt-1 text-xs text-fg-subtle">
          {total} {total === 1 ? "registro" : "registros"} · solo lectura
        </p>
      </header>

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
    </section>
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
