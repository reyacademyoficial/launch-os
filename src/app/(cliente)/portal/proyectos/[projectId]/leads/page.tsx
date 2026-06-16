import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_PAGE_SIZE,
  SORTABLE_COLUMNS,
  SORT_DIRECTIONS,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  type LeadStatus,
} from "@/lib/leads/types";
import { listClientLeadsPaginated } from "@/lib/client-portal/leads";

export const metadata: Metadata = { title: "Leads · Portal" };

const STATUS_VARIANT: Record<LeadStatus, "success" | "warning" | "info" | "neutral"> = {
  frio: "neutral",
  tibio: "warning",
  agendado: "info",
  cerrado: "success",
  perdido: "neutral",
};

/**
 * Tabla nominal de leads para el cliente. Frontera dura:
 *   - Solo columnas safe (sin team_member_id).
 *   - Sin botones de crear/editar/borrar; cliente_role no tiene grant write.
 *
 * Estado controlado por URL: q (search), status, page. Tres son suficientes
 * para que la UX sea utilizable sin meter un client component dedicado en
 * esta primera iteración del portal.
 */
export default async function ClientLeadsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;

  const status = pickStatus(sp.status);
  const q = strOf(sp.q);
  const page = numOf(sp.page, 1);
  const sortColumn = pickSort(sp.sort);
  const sortDirection = pickDir(sp.dir);

  const result = await listClientLeadsPaginated({
    projectId,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    filters: { status },
    search: q,
    sortColumn,
    sortDirection,
  });

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="mt-1 text-xs text-fg-subtle">
            {result.totalCount} en total · página {result.page} de {result.totalPages}
          </p>
        </div>
        <a
          href={`/api/portal/proyectos/${projectId}/leads/export?format=csv${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`}
          className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
        >
          Exportar CSV
        </a>
      </header>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs text-fg-subtle">
          Búsqueda
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nombre, teléfono o email…"
            className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-subtle">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          >
            <option value="">Todos</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:opacity-90"
        >
          Filtrar
        </button>
      </form>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Nombre
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Teléfono
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Cargado
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((lead) => (
              <tr
                key={lead.id}
                className="border-t border-border transition-colors hover:bg-bg-elevated"
              >
                <td className="px-4 py-3 font-medium text-fg">{lead.name}</td>
                <td className="px-4 py-3 text-fg-muted">
                  {lead.phone_normalized ?? lead.contact ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[lead.status]}>
                    {LEAD_STATUS_LABELS[lead.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-fg-subtle">
                  {new Date(lead.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-fg-subtle"
                >
                  Sin leads para los filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result.totalPages > 1 && (
        <Pagination
          basePath={`/portal/proyectos/${projectId}/leads`}
          q={q}
          status={status}
          page={result.page}
          totalPages={result.totalPages}
        />
      )}
    </section>
  );
}

function Pagination({
  basePath,
  q,
  status,
  page,
  totalPages,
}: {
  readonly basePath: string;
  readonly q: string;
  readonly status: LeadStatus | undefined;
  readonly page: number;
  readonly totalPages: number;
}) {
  function url(p: number): string {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  }
  return (
    <nav className="flex items-center justify-between gap-3 text-sm">
      {page > 1 ? (
        <Link href={url(page - 1)} className="text-fg-muted hover:text-fg">
          ← Anterior
        </Link>
      ) : (
        <span className="text-fg-subtle">← Anterior</span>
      )}
      <span className="text-fg-subtle">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={url(page + 1)} className="text-fg-muted hover:text-fg">
          Siguiente →
        </Link>
      ) : (
        <span className="text-fg-subtle">Siguiente →</span>
      )}
    </nav>
  );
}

function strOf(v: string | string[] | undefined): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v[0]!;
  return "";
}

function numOf(v: string | string[] | undefined, fallback: number): number {
  const s = strOf(v);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function pickStatus(v: string | string[] | undefined): LeadStatus | undefined {
  const s = strOf(v);
  return (LEAD_STATUSES as ReadonlyArray<string>).includes(s)
    ? (s as LeadStatus)
    : undefined;
}

function pickSort(v: string | string[] | undefined): SortableColumn {
  const s = strOf(v);
  return (SORTABLE_COLUMNS as ReadonlyArray<string>).includes(s)
    ? (s as SortableColumn)
    : "created_at";
}

function pickDir(v: string | string[] | undefined): SortDirection {
  const s = strOf(v);
  return (SORT_DIRECTIONS as ReadonlyArray<string>).includes(s)
    ? (s as SortDirection)
    : "desc";
}
