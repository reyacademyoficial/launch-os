"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition, type CSSProperties } from "react";

import {
  applySortParams,
  KgDataTable,
  KgSelectionBar,
  type Column,
} from "@/components/kg/data-table";
import { KgFilterSelect } from "@/components/kg/filter-select";
import { KgPageFilters } from "@/components/kg/page-menu";
import { KgPaginator } from "@/components/kg/paginator";
import { RangePills } from "@/components/kg/range-pills";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import {
  bulkAssignSetter,
  bulkUpdateLeadStatus,
  promoteLeadsToKanban,
  unpromoteLeadsFromKanban,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/bulk-actions";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads/types";
import {
  SOURCES,
  type SortableColumn,
  type SortDirection,
} from "@/lib/leads/search-config";
import type { TeamMemberRow } from "@/lib/team/types";

/**
 * Tabla a volumen. Server-paginated/filtered/searched/sorted. Client component
 * solo para:
 *   - manejar la selección (checkbox por fila + header).
 *   - sincronizar filtros/búsqueda/sort con la URL (?status=...&page=2).
 *   - mostrar la barra flotante con las bulk actions cuando hay seleccionados.
 *
 * El data fetch ocurre en el page server-component, que lee los searchParams.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN AL CHASIS KG
 * ───────────────────────────────────────────────────────────────────────────
 * La <table> a mano se reemplazó por `KgDataTable`, que ya trae las capacidades
 * que esta vista necesitaba: selección controlada, orden por header
 * sincronizado a `?sort=&dir=`, y un footer con slot para el paginador.
 *
 * Los filtros dejaron de vivir inline arriba de la tabla: ahora se registran
 * en el drawer/bottom-sheet de página (`KgPageFilters`). El motivo es alto
 * vertical — la grilla de 8 controles se comía media pantalla y obligaba a
 * scrollear la página para ver tres filas de leads. En el drawer, la tabla
 * entra entera y scrollea sola dentro del Panel (`fillHeight`).
 */
export function LeadsTable({
  projectId,
  rows,
  totalCount,
  page,
  pageSize,
  initialSearch,
  initialFilters,
  initialSort,
  teamMembers,
  launches,
  evergreenLaunches,
}: {
  readonly projectId: string;
  readonly rows: ReadonlyArray<LeadRow>;
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  /**
   * Lo calcula el server, pero `KgPaginator` lo deriva solo de
   * `totalCount / pageSize`. Se mantiene en el contrato para no tocar el call
   * site; simplemente no se desestructura.
   */
  readonly totalPages: number;
  readonly initialSearch: string;
  readonly initialFilters: {
    status: string;
    source: string;
    teamMemberId: string;
    launchId: string;
    dateFrom: string;
    dateTo: string;
    recycledFrom: string;
  };
  readonly initialSort: { column: SortableColumn; direction: SortDirection };
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly evergreenLaunches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  /**
   * La selección se guarda JUNTO con la URL que la produjo. Cuando cambia
   * cualquier filtro/página/orden los IDs marcados dejan de estar visibles y
   * la selección tiene que morir — antes eso se hacía con un `setSelectedIds`
   * dentro de `updateUrl`, pero ahora los filtros navegan solos desde
   * `KgFilterSelect` (hace `router.push` por su cuenta) y ya no pasan por acá.
   * Derivarlo en render es la única forma sin `useEffect`
   * (`react-hooks/set-state-in-effect` es ERROR en este repo).
   */
  const urlKey = searchParams.toString();
  const [selection, setSelection] = useState<{
    readonly key: string;
    readonly ids: ReadonlySet<string>;
  }>(() => ({ key: urlKey, ids: EMPTY_SELECTION }));
  const selectedIds =
    selection.key === urlKey ? selection.ids : EMPTY_SELECTION;
  const selectedArr = Array.from(selectedIds);

  function commitSelection(ids: ReadonlySet<string>) {
    setSelection({ key: urlKey, ids });
  }

  const memberById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m])),
    [teamMembers],
  );
  const launchById = useMemo(
    () => new Map(launches.map((l) => [l.id, l])),
    [launches],
  );

  const basePath = `/proyectos/${projectId}/leads`;

  /**
   * Href absoluto con el patch aplicado sobre los params actuales. Absoluto y
   * no relativo porque lo consumen `<Link>` (paginador) y `KgFilterSelect`,
   * que hacen `router.push(href)` — un `?foo=1` suelto depende del pathname
   * activo y acá sabemos exactamente cuál es.
   */
  function buildHref(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    // Cualquier cambio de filtro/sort/search resetea a página 1.
    if (!("page" in patch)) next.delete("page");
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  function updateUrl(patch: Record<string, string | null>) {
    startTransition(() => {
      router.replace(buildHref(patch), { scroll: false });
    });
  }

  /** El blur dispara igual que el Enter, pero sin navegar si nada cambió. */
  function submitSearch(value: string) {
    const next = value.trim();
    if (next === initialSearch) return;
    updateUrl({ q: next || null });
  }

  // ─── Columnas ─────────────────────────────────────────────────────────
  // `sortKey` separa presentación de contrato: la columna "Cargado" ordena
  // por `created_at`, que es lo que el server entiende.
  const columns: ReadonlyArray<Column<LeadRow>> = [
    {
      key: "name",
      label: "Nombre",
      sortable: true,
      render: (lead) => (
        <span style={{ fontWeight: 600, color: "var(--kg-text-1)" }}>
          {lead.name}
        </span>
      ),
    },
    {
      key: "contacto",
      label: "Contacto / teléfono",
      render: (lead) => (
        <span className="kg-num" style={{ color: "var(--kg-text-2)" }}>
          {lead.phone_normalized ?? lead.contact ?? "—"}
        </span>
      ),
    },
    {
      key: "email",
      label: "Email",
      render: (lead) =>
        lead.email ?? <span style={{ color: "var(--kg-text-3)" }}>—</span>,
    },
    {
      key: "source",
      label: "Origen",
      sortable: true,
      // Sin dot: el origen no es un estado, es una etiqueta de procedencia.
      // Un StatusPill acá metería un punto de color por fila sin semántica.
      render: (lead) => (
        <span style={{ color: "var(--kg-text-2)" }}>{lead.source}</span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      sortable: true,
      render: (lead) => (
        <StatusPill
          text={LEAD_STATUS_LABELS[lead.status]}
          tone={STATUS_TONE[lead.status]}
        />
      ),
    },
    {
      key: "setter",
      label: "Setter",
      render: (lead) => {
        const setter = lead.team_member_id
          ? memberById.get(lead.team_member_id)
          : null;
        return setter ? (
          <span style={{ color: "var(--kg-text-2)" }}>{setter.name}</span>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>Sin asignar</span>
        );
      },
    },
    {
      key: "launch",
      label: "Lanzamiento",
      render: (lead) => {
        const launch = lead.launch_id ? launchById.get(lead.launch_id) : null;
        const recycledFrom = lead.recycled_from_launch_id
          ? launchById.get(lead.recycled_from_launch_id)
          : null;
        return (
          <>
            <div style={{ color: "var(--kg-text-2)" }}>
              {launch?.name ?? "—"}
            </div>
            {recycledFrom && (
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)" }}
                title="Reciclado desde un evergreen"
              >
                ↩ desde {recycledFrom.name}
              </div>
            )}
          </>
        );
      },
    },
    {
      key: "cargado",
      label: "Cargado",
      sortable: true,
      // El param que viaja en la URL es el nombre de la columna en la DB.
      sortKey: "created_at",
      render: (lead) => (
        <span className="kg-num" style={{ color: "var(--kg-text-3)" }}>
          {new Date(lead.created_at).toLocaleDateString("es-AR")}
        </span>
      ),
    },
    {
      key: "kanban",
      label: "Kanban",
      align: "center",
      render: (lead) =>
        lead.pinned_to_kanban ? (
          <span
            aria-label="En el kanban"
            title="En el kanban"
            style={{ color: "var(--kg-accent-text)" }}
          >
            ★
          </span>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ),
    },
  ];

  const activeFilterCount =
    (initialSearch ? 1 : 0) +
    (initialFilters.status ? 1 : 0) +
    (initialFilters.source ? 1 : 0) +
    (initialFilters.teamMemberId ? 1 : 0) +
    (initialFilters.launchId ? 1 : 0) +
    (initialFilters.recycledFrom ? 1 : 0) +
    (initialFilters.dateFrom || initialFilters.dateTo ? 1 : 0);

  return (
    <>
      {/*
        Los filtros NO se renderizan acá: `KgPageFilters` los registra en el
        drawer (desktop) / bottom-sheet (mobile) que abre el botón "Filtros"
        del ContextBar. Devuelve null, por eso puede vivir en cualquier punto
        del árbol.
      */}
      <KgPageFilters activeCount={activeFilterCount}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
            }}
          >
            <label
              htmlFor="leads-buscar"
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
            >
              Buscar
            </label>
            {/*
              Input NO controlado a propósito. El nodo de filtros se registra
              en el sheet vía efecto; si el value viviera en un `useState` de
              este componente, cada tecla re-registraría el grupo entero y el
              <input> del sheet quedaría un commit detrás del DOM. Sin estado,
              el nodo es estable y el browser maneja el tipeo.
              El `key` lo remonta cuando el server manda otro `q` (back/forward
              del browser) — remount en vez de `setState` en un efecto, que
              `react-hooks/set-state-in-effect` prohíbe.
            */}
            <input
              key={initialSearch}
              id="leads-buscar"
              type="search"
              className="kg-focus"
              placeholder="Nombre, teléfono o email…"
              defaultValue={initialSearch}
              // Enter y blur disparan la búsqueda — igual que antes. No se
              // busca por tecla: cada búsqueda es una navegación al server.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitSearch(e.currentTarget.value);
                }
              }}
              onBlur={(e) => submitSearch(e.currentTarget.value)}
              style={fieldStyle}
            />
          </div>

          <KgFilterSelect
            label="Estado"
            active={initialFilters.status}
            options={[
              { value: "", label: "Todos", href: buildHref({ status: null }) },
              ...LEAD_STATUSES.map((s) => ({
                value: s,
                label: LEAD_STATUS_LABELS[s],
                href: buildHref({ status: s }),
              })),
            ]}
          />

          <KgFilterSelect
            label="Origen"
            active={initialFilters.source}
            options={[
              { value: "", label: "Todos", href: buildHref({ source: null }) },
              ...SOURCES.map((s) => ({
                value: s,
                label: s,
                href: buildHref({ source: s }),
              })),
            ]}
          />

          <KgFilterSelect
            label="Setter"
            active={initialFilters.teamMemberId}
            options={[
              { value: "", label: "Todos", href: buildHref({ setter: null }) },
              ...teamMembers.map((m) => ({
                value: m.id,
                label: m.name,
                href: buildHref({ setter: m.id }),
              })),
            ]}
          />

          <KgFilterSelect
            label="Lanzamiento"
            active={initialFilters.launchId}
            options={[
              { value: "", label: "Todos", href: buildHref({ launch: null }) },
              ...launches.map((l) => ({
                value: l.id,
                label: l.name,
                href: buildHref({ launch: l.id }),
              })),
            ]}
          />

          <KgFilterSelect
            label="Reciclado de"
            active={initialFilters.recycledFrom}
            options={[
              {
                value: "",
                label: "Todos",
                href: buildHref({ recycled: null }),
              },
              {
                value: "any",
                label: "Cualquier reciclado",
                href: buildHref({ recycled: "any" }),
              },
              {
                value: "none",
                label: "No reciclados",
                href: buildHref({ recycled: "none" }),
              },
              ...evergreenLaunches.map((l) => ({
                value: l.id,
                label: l.name,
                href: buildHref({ recycled: l.id }),
              })),
            ]}
          />

          <DateRangeFilter
            from={initialFilters.dateFrom}
            to={initialFilters.dateTo}
            onChange={(from, to) =>
              updateUrl({ from: from || null, to: to || null })
            }
          />
        </div>
      </KgPageFilters>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(lead) => lead.id}
        totalCount={totalCount}
        // El body scrollea dentro del Panel: la tabla nunca hace scrollear la
        // página. Requiere `Panel fillHeight` en la page.
        fillHeight
        emptyTitle="Sin leads con los filtros actuales"
        emptyHint="Ajustá o limpiá los filtros desde el botón Filtros, o cargá leads nuevos con + Nuevo lead."
        sort={{
          key: initialSort.column,
          dir: initialSort.direction,
          // `nextSortDir` lo aplica la propia tabla antes de llamar acá (asc →
          // desc → asc sobre la misma columna). `applySortParams` escribe
          // ?sort=&dir= y borra ?page= — el mismo contrato que había a mano.
          onChange: (key, dir) =>
            startTransition(() => {
              const next = applySortParams(
                new URLSearchParams(searchParams.toString()),
                key,
                dir,
              );
              router.replace(`${basePath}?${next.toString()}`, {
                scroll: false,
              });
            }),
        }}
        selection={{
          selectedIds,
          onToggleRow: (id, checked) => {
            const next = new Set(selectedIds);
            if (checked) next.add(id);
            else next.delete(id);
            commitSelection(next);
          },
          onToggleAll: (checked, visibleIds) =>
            commitSelection(checked ? new Set(visibleIds) : new Set()),
          rowLabel: (lead) => `Seleccionar ${lead.name}`,
        }}
        footerActions={
          <KgPaginator
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            hrefFor={(n) => buildHref({ page: n > 1 ? String(n) : null })}
            compact
          />
        }
      />

      {/*
        La `KgSelectionBar` se portalea sola a `body` (ver
        `kg/selection-bar.tsx`): esta tabla vive dentro de un `Panel`, que en
        tema oscuro trae `backdrop-filter` y convertiría a ese Panel en
        containing block de cualquier `position: fixed` adentro. Acá solo se
        monta el contenido.
      */}
      {selectedArr.length > 0 && (
        <BulkActionsBar
          projectId={projectId}
          selectedIds={selectedArr}
          teamMembers={teamMembers}
          onDone={() => commitSelection(new Set())}
        />
      )}
    </>
  );
}

/** Un solo Set vacío compartido: evita crear identidad nueva en cada render. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * Tono semántico del estado. `frio` queda sin tono a propósito: un lead nuevo
 * no es ni bueno ni malo, y pintarlo sumaría un color más a la grilla.
 */
const STATUS_TONE: Record<LeadStatus, string | undefined> = {
  frio: undefined,
  tibio: TONE_VAR.warning,
  agendado: TONE_VAR.accent,
  cerrado: TONE_VAR.positive,
  perdido: TONE_VAR.negative,
};

// ─── Filtro de rango de fechas ───────────────────────────────────────────

/**
 * "Personalizado" es un valor posible pero NO una pill: cuando el rango sale
 * de los inputs de fecha ninguna pill queda encendida. Está en el union para
 * poder expresar ese estado sin castear.
 */
type DatePreset = "Todo" | "7 días" | "30 días" | "90 días" | "Personalizado";

const DATE_PRESETS: ReadonlyArray<DatePreset> = [
  "Todo",
  "7 días",
  "30 días",
  "90 días",
];
const DATE_PRESET_DAYS: ReadonlyArray<{
  readonly label: DatePreset;
  readonly days: number;
}> = [
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
];

/**
 * Presets rápidos + los dos inputs de fecha (que siguen siendo la fuente de
 * verdad: el contrato de URL es `?from=&to=` en YMD, sin un param `range`).
 *
 * El preset activo NO se deriva de las fechas: eso obligaría a calcular "hoy"
 * durante el render, y el server (UTC) y el browser (-03) pueden estar en días
 * distintos → mismatch de hidratación. Los presets son atajos que escriben las
 * fechas; el estado real se lee en los inputs, que muestran el rango exacto.
 * Solo "Todo" (sin fechas) se puede afirmar sin mirar el reloj.
 */
function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  readonly from: string;
  readonly to: string;
  readonly onChange: (from: string, to: string) => void;
}) {
  const active: DatePreset = !from && !to ? "Todo" : "Personalizado";

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
    >
      <span
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        Rango de carga
      </span>
      <RangePills
        options={DATE_PRESETS}
        value={active}
        onChange={(next) => {
          if (next === "Todo") {
            onChange("", "");
            return;
          }
          const preset = DATE_PRESET_DAYS.find((p) => p.label === next);
          if (!preset) return;
          // `new Date()` corre en el click (cliente), nunca en render.
          const today = new Date();
          const start = new Date();
          start.setDate(start.getDate() - (preset.days - 1));
          onChange(ymdLocal(start), ymdLocal(today));
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <input
          type="date"
          className="kg-focus"
          aria-label="Fecha desde"
          value={from}
          max={to || undefined}
          onChange={(e) => onChange(e.target.value, to)}
          style={{ ...fieldStyle, flex: 1 }}
        />
        <input
          type="date"
          className="kg-focus"
          aria-label="Fecha hasta"
          value={to}
          min={from || undefined}
          onChange={(e) => onChange(from, e.target.value)}
          style={{ ...fieldStyle, flex: 1 }}
        />
      </div>
    </div>
  );
}

/** YMD en hora LOCAL — `toISOString()` correría el día en UTC-3. */
function ymdLocal(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? `0${m}` : m}-${day < 10 ? `0${day}` : day}`;
}

// ─── Acciones masivas ────────────────────────────────────────────────────

/**
 * Controles de la barra flotante. La barra en sí la dibuja `KgSelectionBar`
 * (fixed al fondo del viewport, respeta el safe-area de iOS); acá solo vive
 * QUÉ acciones hay y el estado `pending` / `message` de la última ejecución.
 */
function BulkActionsBar({
  projectId,
  selectedIds,
  teamMembers,
  onDone,
}: {
  readonly projectId: string;
  readonly selectedIds: ReadonlyArray<string>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
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

  const control: CSSProperties = {
    ...barControlStyle,
    cursor: pending ? "wait" : "pointer",
    opacity: pending ? 0.6 : 1,
  };

  return (
    <KgSelectionBar
      count={selectedIds.length}
      noun="leads"
      message={message}
      onClear={onDone}
    >
      <button
        type="button"
        className="kg-focus"
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
        style={control}
      >
        ★ Al kanban
      </button>

      <button
        type="button"
        className="kg-focus"
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
        style={control}
      >
        Sacar del kanban
      </button>

      <select
        className="kg-focus"
        aria-label="Cambiar estado de los leads seleccionados"
        disabled={pending}
        defaultValue=""
        onChange={(e) => {
          const value = e.target.value;
          // Se resetea a "" para que elegir dos veces el mismo estado vuelva a
          // disparar el onChange.
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
        style={control}
      >
        <option value="">Cambiar estado…</option>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <select
        className="kg-focus"
        aria-label="Asignar setter a los leads seleccionados"
        disabled={pending}
        defaultValue=""
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
        style={control}
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
    </KgSelectionBar>
  );
}

// ─── Estilos compartidos ─────────────────────────────────────────────────

/** Input del drawer de filtros. Mismo look que el <select> de KgFilterSelect. */
const fieldStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  fontWeight: 600,
  colorScheme: "dark",
};

/** Botón / select dentro de la KgSelectionBar. */
const barControlStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 11,
  fontWeight: 700,
  colorScheme: "dark",
};
