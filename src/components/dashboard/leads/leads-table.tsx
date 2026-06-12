"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  bulkAssignSetter,
  bulkUpdateLeadStatus,
  promoteLeadsToKanban,
  unpromoteLeadsFromKanban,
} from "@/app/(app)/proyectos/[projectId]/leads/bulk-actions";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads/types";
import {
  SORTABLE_COLUMNS,
  SOURCES,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import type { TeamMemberRow } from "@/lib/team/types";

/**
 * Tabla a volumen. Server-paginated/filtered/searched/sorted. Client component
 * solo para:
 *   - manejar la selección (checkbox por fila + headers).
 *   - sincronizar filtros/búsqueda/sort con la URL (?status=...&page=2).
 *   - mostrar la barra flotante con las bulk actions cuando hay seleccionados.
 *
 * El data fetch ocurre en el page server-component, que lee los searchParams.
 */
export function LeadsTable({
  projectId,
  rows,
  totalCount,
  page,
  pageSize: _pageSize,
  totalPages,
  initialSearch,
  initialFilters,
  initialSort,
  teamMembers,
  launches,
}: {
  readonly projectId: string;
  readonly rows: ReadonlyArray<LeadRow>;
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly initialSearch: string;
  readonly initialFilters: {
    status: string;
    source: string;
    teamMemberId: string;
    launchId: string;
    dateFrom: string;
    dateTo: string;
  };
  readonly initialSort: { column: SortableColumn; direction: SortDirection };
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [searchInput, setSearchInput] = useState(initialSearch);

  const memberById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m])),
    [teamMembers],
  );
  const launchById = useMemo(
    () => new Map(launches.map((l) => [l.id, l])),
    [launches],
  );

  function updateUrl(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    // Cualquier cambio de filtro/sort/search resetea a página 1.
    if (!("page" in patch)) next.delete("page");
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false });
      // Limpio selección al cambiar de query — los IDs ya no son visibles.
      setSelectedIds(new Set());
    });
  }

  function toggleSort(col: SortableColumn) {
    const isCurrent = initialSort.column === col;
    const nextDir: SortDirection =
      isCurrent && initialSort.direction === "asc" ? "desc" : "asc";
    updateUrl({ sort: col, dir: nextDir });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const selectedArr = Array.from(selectedIds);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="grid gap-3 rounded-md border border-border bg-surface/40 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => updateUrl({ q: searchInput || null })}
        />
        <FilterSelect
          label="Estado"
          value={initialFilters.status}
          onChange={(v) => updateUrl({ status: v })}
          options={[
            { value: "", label: "Todos" },
            ...LEAD_STATUSES.map((s) => ({
              value: s,
              label: LEAD_STATUS_LABELS[s],
            })),
          ]}
        />
        <FilterSelect
          label="Origen"
          value={initialFilters.source}
          onChange={(v) => updateUrl({ source: v })}
          options={[
            { value: "", label: "Todos" },
            ...SOURCES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <FilterSelect
          label="Setter"
          value={initialFilters.teamMemberId}
          onChange={(v) => updateUrl({ setter: v })}
          options={[
            { value: "", label: "Todos" },
            ...teamMembers.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <FilterSelect
          label="Lanzamiento"
          value={initialFilters.launchId}
          onChange={(v) => updateUrl({ launch: v })}
          options={[
            { value: "", label: "Todos" },
            ...launches.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />
        <DateRange
          from={initialFilters.dateFrom}
          to={initialFilters.dateTo}
          onChange={(from, to) =>
            updateUrl({ from: from || null, to: to || null })
          }
        />
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los visibles"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <SortableHeader
                column="name"
                label="Nombre"
                currentColumn={initialSort.column}
                currentDir={initialSort.direction}
                onClick={toggleSort}
              />
              <th scope="col" className="px-3 py-3 font-medium">
                Contacto / teléfono
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Email
              </th>
              <SortableHeader
                column="source"
                label="Origen"
                currentColumn={initialSort.column}
                currentDir={initialSort.direction}
                onClick={toggleSort}
              />
              <SortableHeader
                column="status"
                label="Estado"
                currentColumn={initialSort.column}
                currentDir={initialSort.direction}
                onClick={toggleSort}
              />
              <th scope="col" className="px-3 py-3 font-medium">
                Setter
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Lanzamiento
              </th>
              <SortableHeader
                column="created_at"
                label="Cargado"
                currentColumn={initialSort.column}
                currentDir={initialSort.direction}
                onClick={toggleSort}
              />
              <th scope="col" className="px-3 py-3 text-center font-medium">
                Kanban
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-fg-muted">
                  Sin resultados con los filtros actuales.
                </td>
              </tr>
            ) : (
              rows.map((lead) => {
                const checked = selectedIds.has(lead.id);
                const setter = lead.team_member_id
                  ? memberById.get(lead.team_member_id)
                  : null;
                const launch = lead.launch_id
                  ? launchById.get(lead.launch_id)
                  : null;
                return (
                  <tr
                    key={lead.id}
                    className={
                      "border-t border-border " +
                      (checked ? "bg-accent/5" : "hover:bg-surface")
                    }
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${lead.name}`}
                        checked={checked}
                        onChange={(e) => toggleRow(lead.id, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-fg">{lead.name}</div>
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {lead.phone_normalized ?? lead.contact ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {lead.email ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-fg-subtle">
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-fg">
                        {LEAD_STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {setter?.name ?? "Sin asignar"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {launch?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {new Date(lead.created_at).toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {lead.pinned_to_kanban && (
                        <span
                          aria-label="En el kanban"
                          title="En el kanban"
                          className="inline-block rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent"
                        >
                          ★
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-fg-subtle">
          {totalCount} resultados · página {page} de {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => updateUrl({ page: String(page - 1) })}
            className="!px-3 !py-1 !text-xs"
          >
            ← Anterior
          </Button>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => updateUrl({ page: String(page + 1) })}
            className="!px-3 !py-1 !text-xs"
          >
            Siguiente →
          </Button>
        </div>
      </div>

      {/* Barra flotante de bulk actions */}
      {selectedArr.length > 0 && (
        <BulkActionsBar
          projectId={projectId}
          selectedIds={selectedArr}
          teamMembers={teamMembers}
          onDone={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}

function SortableHeader({
  column,
  label,
  currentColumn,
  currentDir,
  onClick,
}: {
  readonly column: SortableColumn;
  readonly label: string;
  readonly currentColumn: SortableColumn;
  readonly currentDir: SortDirection;
  readonly onClick: (col: SortableColumn) => void;
}) {
  const isCurrent = currentColumn === column;
  const arrow = isCurrent ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <th scope="col" className="px-3 py-3 font-medium">
      <button
        type="button"
        onClick={() => onClick(column)}
        className="inline-flex items-center gap-1 hover:text-fg"
      >
        {label} <span className="text-fg-subtle">{arrow}</span>
      </button>
    </th>
  );
}

function SearchBox({
  value,
  onChange,
  onSubmit,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <div className="sm:col-span-2 lg:col-span-2">
      <label className="block text-xs font-medium text-fg-subtle">
        Buscar
        <input
          type="search"
          placeholder="Nombre, teléfono o email…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          onBlur={onSubmit}
          className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
        />
      </label>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-xs font-medium text-fg-subtle">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateRange({
  from,
  to,
  onChange,
}: {
  readonly from: string;
  readonly to: string;
  readonly onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="sm:col-span-2 lg:col-span-2">
      <label className="block text-xs font-medium text-fg-subtle">
        Rango de fecha
        <div className="mt-1 flex gap-1">
          <input
            type="date"
            value={from}
            onChange={(e) => onChange(e.target.value, to)}
            className="flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => onChange(from, e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          />
        </div>
      </label>
    </div>
  );
}

function BulkActionsBar({
  projectId,
  selectedIds,
  teamMembers,
  onDone,
}: {
  readonly projectId: string;
  readonly selectedIds: ReadonlyArray<string>;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run<T>(action: () => Promise<T>, label: (result: T) => string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(label(result));
      onDone();
    });
  }

  return (
    <div
      role="region"
      aria-label="Acciones masivas"
      className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-bg-elevated p-3 shadow-lg"
    >
      <span className="text-sm font-medium text-fg">
        {selectedIds.length} seleccionados
      </span>

      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          run(
            () => promoteLeadsToKanban(projectId, selectedIds),
            (r) =>
              "affected" in r
                ? `Promovidos al kanban: ${r.affected}`
                : `Error: ${r.error}`,
          )
        }
        className="!px-3 !py-1 !text-xs"
      >
        ★ Al kanban
      </Button>

      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          run(
            () => unpromoteLeadsFromKanban(projectId, selectedIds),
            (r) =>
              "affected" in r
                ? `Sacados del kanban: ${r.affected}`
                : `Error: ${r.error}`,
          )
        }
        className="!px-3 !py-1 !text-xs"
      >
        Sacar del kanban
      </Button>

      <select
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          e.target.value = "";
          if (!value) return;
          const status = value as LeadStatus;
          run(
            () => bulkUpdateLeadStatus(projectId, selectedIds, status),
            (r) =>
              "affected" in r
                ? `Estado actualizado: ${r.affected}`
                : `Error: ${r.error}`,
          );
        }}
        defaultValue=""
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg"
      >
        <option value="">Cambiar estado…</option>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <select
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          e.target.value = "";
          if (value === "") return;
          const memberId = value === "__none__" ? null : value;
          run(
            () => bulkAssignSetter(projectId, selectedIds, memberId),
            (r) =>
              "affected" in r
                ? `Setter asignado: ${r.affected}`
                : `Error: ${r.error}`,
          );
        }}
        defaultValue=""
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg"
      >
        <option value="">Asignar setter…</option>
        <option value="__none__">— Sin asignar —</option>
        {teamMembers
          .filter((m) => m.active)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>

      {message && (
        <span className="ml-auto text-xs text-fg-muted">{message}</span>
      )}
    </div>
  );
}

// Silencio el unused para SORTABLE_COLUMNS importado (re-export implicit via type).
void SORTABLE_COLUMNS;
