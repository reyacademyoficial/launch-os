"use client";

import { useMemo, useState } from "react";

import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/proyectos/[projectId]/leads/sale-actions";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtDate, fmtMoney, fmtPercent } from "@/lib/format";
import type { LeadRow } from "@/lib/leads/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { SaleModal } from "./sale-modal";

type CreateSaleAction = (
  leadId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type AddPaymentAction = (
  saleId: string,
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;
type DeletePaymentAction = (paymentId: string) => Promise<void>;
type DeleteSaleAction = (saleId: string) => Promise<void>;

type LeadForCobros = Pick<
  LeadRow,
  "id" | "name" | "launch_id" | "team_member_id" | "status"
>;

type CollectionStatus = "all" | "paid" | "partial" | "unpaid";

interface FilterState {
  query: string;
  closerId: string; // "all" | "unassigned" | team_member_id
  modalityId: string; // "all" | payment_modality_id
  collection: CollectionStatus;
}

const EMPTY_FILTERS: FilterState = {
  query: "",
  closerId: "all",
  modalityId: "all",
  collection: "all",
};

/**
 * Vista interactiva del tab Cobros. Owns filter state y las dos tablas
 * (ventas cerradas + historial de cobros). Reusa `SaleModal` en modo
 * "venta existente" para registrar cobros sin bajar a Leads → Kanban.
 *
 * Los filtros se comparten entre las dos tablas: un pago se muestra si su
 * venta pasa el filtro. Idea: buscar "Juan" filtra a las ventas de Juan
 * arriba y sus cobros abajo, sin duplicar controles.
 */
export function CobrosView({
  sales,
  payments,
  leads,
  modalities,
  rules,
  teamMembers,
  canEdit,
  createSaleAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly leads: ReadonlyArray<LeadForCobros>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly canEdit: boolean;
  readonly createSaleAction: CreateSaleAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction: DeleteSaleAction;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const leadById = useMemo(
    () => new Map(leads.map((l) => [l.id, l])),
    [leads],
  );
  const modalityById = useMemo(
    () => new Map(modalities.map((m) => [m.id, m])),
    [modalities],
  );
  const memberById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m])),
    [teamMembers],
  );

  const collectedBySale = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of payments) {
      out.set(p.sale_id, (out.get(p.sale_id) ?? 0) + Number(p.amount));
    }
    return out;
  }, [payments]);

  // Ranks para pasarle al SaleModal (necesarios para preview de comisión).
  // buildSaleRanks recibe un LeadRow-like; pasamos lo que tenemos.
  const rankBySaleId = useMemo(
    () =>
      buildSaleRanks(
        sales as unknown as SaleRow[],
        leads as unknown as LeadRow[],
      ),
    [sales, leads],
  );

  const paymentsSorted = useMemo(
    () => [...payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
    [payments],
  );
  const accumByPaymentId = useMemo(() => {
    const out = new Map<string, number>();
    const running = new Map<string, number>();
    for (const p of paymentsSorted) {
      const next = (running.get(p.sale_id) ?? 0) + Number(p.amount);
      running.set(p.sale_id, next);
      out.set(p.id, next);
    }
    return out;
  }, [paymentsSorted]);

  const normalizedQuery = filters.query.trim().toLowerCase();

  function saleMatches(sale: SaleRow): boolean {
    const lead = leadById.get(sale.lead_id);
    if (!lead) return false;

    if (normalizedQuery && !lead.name.toLowerCase().includes(normalizedQuery)) {
      return false;
    }

    // Atribución: `lead.team_member_id` es la fuente única de verdad
    // (kanban + leaderboard hacen lo mismo). `sale.team_member_id` es
    // denormalización y puede quedar desincronizada.
    if (filters.closerId !== "all") {
      const ownerId = lead.team_member_id;
      if (filters.closerId === "unassigned") {
        if (ownerId !== null) return false;
      } else if (ownerId !== filters.closerId) {
        return false;
      }
    }

    if (
      filters.modalityId !== "all" &&
      sale.payment_modality_id !== filters.modalityId
    ) {
      return false;
    }

    if (filters.collection !== "all") {
      const collected = collectedBySale.get(sale.id) ?? 0;
      const total = Number(sale.total_amount) || 0;
      const status: CollectionStatus =
        collected <= 0
          ? "unpaid"
          : collected >= total
            ? "paid"
            : "partial";
      if (status !== filters.collection) return false;
    }

    return true;
  }

  const filteredSales = useMemo(
    () => sales.filter(saleMatches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, filters, leadById, collectedBySale],
  );
  const filteredSaleIds = useMemo(
    () => new Set(filteredSales.map((s) => s.id)),
    [filteredSales],
  );

  // Pagos filtrados = pagos cuyo sale pasó el filtro. Ordenados desc por fecha.
  const filteredPayments = useMemo(
    () =>
      payments
        .filter((p) => filteredSaleIds.has(p.sale_id))
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
    [payments, filteredSaleIds],
  );

  const filtersActive =
    filters.query !== "" ||
    filters.closerId !== "all" ||
    filters.modalityId !== "all" ||
    filters.collection !== "all";

  // Sólo mostramos en el dropdown de closer a los miembros que efectivamente
  // aparecen como dueños de leads con ventas del launch. Usa lead.team_member_id
  // (misma atribución que kanban + leaderboard).
  const closersInSales = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sales) {
      const ownerId = leadById.get(s.lead_id)?.team_member_id ?? null;
      if (ownerId) ids.add(ownerId);
    }
    return teamMembers.filter((m) => ids.has(m.id));
  }, [sales, leadById, teamMembers]);

  const hasUnassignedSales = sales.some(
    (s) => (leadById.get(s.lead_id)?.team_member_id ?? null) === null,
  );

  return (
    <div className="space-y-6">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        closers={closersInSales}
        modalities={modalities}
        hasUnassignedSales={hasUnassignedSales}
        totalSalesCount={sales.length}
        filteredSalesCount={filteredSales.length}
        filtersActive={filtersActive}
      />

      <SalesTable
        sales={filteredSales}
        leadById={leadById}
        modalityById={modalityById}
        memberById={memberById}
        collectedBySale={collectedBySale}
        payments={payments}
        rankBySaleId={rankBySaleId}
        modalities={modalities}
        rules={rules}
        teamMembers={teamMembers}
        canEdit={canEdit}
        filtersActive={filtersActive}
        totalSalesCount={sales.length}
        createSaleAction={createSaleAction}
        addPaymentAction={addPaymentAction}
        deletePaymentAction={deletePaymentAction}
        deleteSaleAction={deleteSaleAction}
      />

      <PaymentsTable
        payments={filteredPayments}
        salesById={new Map(sales.map((s) => [s.id, s]))}
        leadById={leadById}
        modalityById={modalityById}
        accumByPaymentId={accumByPaymentId}
        canEdit={canEdit}
        filtersActive={filtersActive}
        totalPaymentsCount={payments.length}
        deletePaymentAction={deletePaymentAction}
      />
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  closers,
  modalities,
  hasUnassignedSales,
  totalSalesCount,
  filteredSalesCount,
  filtersActive,
}: {
  readonly filters: FilterState;
  readonly onChange: (next: FilterState) => void;
  readonly closers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly hasUnassignedSales: boolean;
  readonly totalSalesCount: number;
  readonly filteredSalesCount: number;
  readonly filtersActive: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/40 px-3 py-2">
      <input
        type="search"
        placeholder="Buscar por nombre del alumno…"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        className="min-w-[14rem] flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg placeholder:text-fg-subtle"
        aria-label="Buscar alumno"
      />
      <select
        value={filters.closerId}
        onChange={(e) => onChange({ ...filters, closerId: e.target.value })}
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por closer"
      >
        <option value="all">Todos los closers</option>
        {hasUnassignedSales && <option value="unassigned">Sin asignar</option>}
        {closers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {!c.active ? " (inactivo)" : ""}
          </option>
        ))}
      </select>
      <select
        value={filters.modalityId}
        onChange={(e) => onChange({ ...filters, modalityId: e.target.value })}
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por modalidad"
      >
        <option value="all">Todas las modalidades</option>
        {modalities.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        value={filters.collection}
        onChange={(e) =>
          onChange({ ...filters, collection: e.target.value as CollectionStatus })
        }
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
        aria-label="Filtrar por estado de cobro"
      >
        <option value="all">Cualquier estado</option>
        <option value="paid">Cobrada</option>
        <option value="partial">Parcial</option>
        <option value="unpaid">Sin cobrar</option>
      </select>
      <span className="text-xs text-fg-subtle">
        {filtersActive
          ? `${filteredSalesCount} de ${totalSalesCount} ventas`
          : `${totalSalesCount} ventas`}
      </span>
      {filtersActive && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
        >
          Limpiar
        </button>
      )}
    </div>
  );
}

// ─── Sales table ──────────────────────────────────────────────────────────

function SalesTable({
  sales,
  leadById,
  modalityById,
  memberById,
  collectedBySale,
  payments,
  rankBySaleId,
  modalities,
  rules,
  teamMembers,
  canEdit,
  filtersActive,
  totalSalesCount,
  createSaleAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
}: {
  readonly sales: ReadonlyArray<SaleRow>;
  readonly leadById: ReadonlyMap<string, LeadForCobros>;
  readonly modalityById: ReadonlyMap<string, PaymentModalityRow>;
  readonly memberById: ReadonlyMap<
    string,
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly collectedBySale: ReadonlyMap<string, number>;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly rankBySaleId: ReadonlyMap<string, number>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly canEdit: boolean;
  readonly filtersActive: boolean;
  readonly totalSalesCount: number;
  readonly createSaleAction: CreateSaleAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction: DeleteSaleAction;
}) {
  // Subtotales sobre lo filtrado: si el usuario filtra por "Cobrada", el
  // pactado y el cobrado totales tienen que coincidir en la fila de totales.
  let totalPactado = 0;
  let totalCobrado = 0;
  for (const s of sales) {
    totalPactado += Number(s.total_amount) || 0;
    totalCobrado += collectedBySale.get(s.id) ?? 0;
  }
  const totalPct = totalPactado > 0 ? (totalCobrado / totalPactado) * 100 : 0;
  const totalPendiente = Math.max(totalPactado - totalCobrado, 0);

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-fg">Ventas cerradas</h2>
      {sales.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          {totalSalesCount === 0
            ? "Sin ventas en columna cerrado para este lanzamiento."
            : filtersActive
              ? "Ninguna venta coincide con los filtros aplicados."
              : "Sin ventas."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-3 font-medium">Alumno</th>
                <th className="px-3 py-3 font-medium">Closer</th>
                <th className="px-3 py-3 font-medium">Modalidad</th>
                <th className="px-3 py-3 text-right font-medium">Pactado</th>
                <th className="px-3 py-3 text-right font-medium">Cobrado</th>
                <th className="px-3 py-3 text-right font-medium">% cobrado</th>
                <th className="px-3 py-3 font-medium">Cerrado el</th>
                {canEdit && <th className="px-3 py-3 text-right font-medium">Cobros</th>}
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const lead = leadById.get(s.lead_id);
                const modality = modalityById.get(s.payment_modality_id);
                // Atribución vía lead (fuente única de verdad) — no `s.team_member_id`.
                const ownerId = lead?.team_member_id ?? null;
                const closer = ownerId ? memberById.get(ownerId) : null;
                const collected = collectedBySale.get(s.id) ?? 0;
                const total = Number(s.total_amount) || 0;
                const pct = total > 0 ? (collected / total) * 100 : 0;
                const salePayments = payments.filter((p) => p.sale_id === s.id);
                const leadForModal: Pick<
                  LeadRow,
                  "id" | "name" | "launch_id" | "team_member_id"
                > = lead
                  ? {
                      id: lead.id,
                      name: lead.name,
                      launch_id: lead.launch_id,
                      team_member_id: lead.team_member_id,
                    }
                  : {
                      id: s.lead_id,
                      name: "—",
                      launch_id: null,
                      team_member_id: s.team_member_id,
                    };

                return (
                  <tr
                    key={s.id}
                    className="border-t border-border hover:bg-surface"
                  >
                    <td className="px-3 py-3 font-medium text-fg">
                      {lead?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {closer?.name ?? "Sin asignar"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {modality?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtMoney(total)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtMoney(collected)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                      {fmtPercent(pct)}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {fmtDate(s.closed_at)}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right">
                        <SaleModal
                          triggerLabel={
                            salePayments.length === 0
                              ? "+ Cobro"
                              : `Cobros (${salePayments.length})`
                          }
                          triggerClassName="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent hover:bg-accent/20"
                          lead={leadForModal}
                          sale={s}
                          saleRank={rankBySaleId.get(s.id) ?? 0}
                          payments={salePayments}
                          modalities={modalities}
                          rules={rules}
                          teamMembers={teamMembers}
                          createSaleAction={createSaleAction.bind(
                            null,
                            leadForModal.id,
                          )}
                          addPaymentAction={addPaymentAction.bind(null, s.id)}
                          deletePaymentAction={deletePaymentAction}
                          deleteSaleAction={deleteSaleAction}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
              <tr>
                <td
                  className="px-3 py-3 font-semibold text-fg"
                  colSpan={3}
                >
                  {filtersActive
                    ? `Subtotal filtrado · ${sales.length} venta${sales.length === 1 ? "" : "s"}`
                    : `Total · ${sales.length} venta${sales.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtMoney(totalPactado)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtMoney(totalCobrado)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtPercent(totalPct)}
                </td>
                <td
                  className="px-3 py-3 text-fg-muted"
                  title="Pactado − cobrado en las ventas filtradas"
                >
                  Pendiente {fmtMoney(totalPendiente)}
                </td>
                {canEdit && <td className="px-3 py-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Payments table ───────────────────────────────────────────────────────

function PaymentsTable({
  payments,
  salesById,
  leadById,
  modalityById,
  accumByPaymentId,
  canEdit,
  filtersActive,
  totalPaymentsCount,
  deletePaymentAction,
}: {
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly salesById: ReadonlyMap<string, SaleRow>;
  readonly leadById: ReadonlyMap<string, LeadForCobros>;
  readonly modalityById: ReadonlyMap<string, PaymentModalityRow>;
  readonly accumByPaymentId: ReadonlyMap<string, number>;
  readonly canEdit: boolean;
  readonly filtersActive: boolean;
  readonly totalPaymentsCount: number;
  readonly deletePaymentAction: DeletePaymentAction;
}) {
  let totalMonto = 0;
  for (const p of payments) totalMonto += Number(p.amount) || 0;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">Historial de cobros</h2>
        {filtersActive && (
          <span className="text-xs text-fg-subtle">
            {payments.length} de {totalPaymentsCount} cobros
          </span>
        )}
      </div>
      {payments.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
          {totalPaymentsCount === 0 ? (
            <>
              Sin cobros registrados todavía. Usá <b>+ Cobro</b> en la tabla de
              ventas para cargar el primero.
            </>
          ) : filtersActive ? (
            "Ningún cobro coincide con los filtros aplicados."
          ) : (
            "Sin cobros."
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-3 font-medium">Fecha</th>
                <th className="px-3 py-3 font-medium">Alumno</th>
                <th className="px-3 py-3 font-medium">Modalidad</th>
                <th className="px-3 py-3 text-right font-medium">Monto</th>
                <th className="px-3 py-3 text-right font-medium">
                  Acumulado venta
                </th>
                <th className="px-3 py-3 font-medium">Notas</th>
                {canEdit && <th className="px-3 py-3" aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const sale = salesById.get(p.sale_id);
                const lead = sale ? leadById.get(sale.lead_id) : null;
                const modality = sale
                  ? modalityById.get(sale.payment_modality_id)
                  : null;
                return (
                  <tr
                    key={p.id}
                    className="border-t border-border hover:bg-surface"
                  >
                    <td className="px-3 py-3 text-fg-muted">
                      {fmtDate(p.paid_at)}
                    </td>
                    <td className="px-3 py-3 font-medium text-fg">
                      {lead?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">
                      {modality?.name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg">
                      {fmtMoney(p.amount)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-fg-muted">
                      {fmtMoney(accumByPaymentId.get(p.id) ?? 0)}
                    </td>
                    <td className="px-3 py-3 text-fg-muted">{p.notes ?? ""}</td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right">
                        <DeletePaymentButton
                          paymentId={p.id}
                          amount={Number(p.amount)}
                          deletePaymentAction={deletePaymentAction}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface/60 text-sm">
              <tr>
                <td
                  className="px-3 py-3 font-semibold text-fg"
                  colSpan={3}
                >
                  {filtersActive
                    ? `Subtotal filtrado · ${payments.length} cobro${payments.length === 1 ? "" : "s"}`
                    : `Total · ${payments.length} cobro${payments.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-fg">
                  {fmtMoney(totalMonto)}
                </td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
                {canEdit && <td className="px-3 py-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function DeletePaymentButton({
  paymentId,
  amount,
  deletePaymentAction,
}: {
  readonly paymentId: string;
  readonly amount: number;
  readonly deletePaymentAction: DeletePaymentAction;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (!confirm(`¿Borrar cobro de ${fmtMoney(amount)}?`)) return;
        setPending(true);
        try {
          await deletePaymentAction(paymentId);
        } finally {
          setPending(false);
        }
      }}
      aria-label="Borrar cobro"
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
    >
      {pending ? "…" : "×"}
    </button>
  );
}
