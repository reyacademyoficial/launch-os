"use client";

import { useOptimistic, useState, useTransition, type DragEvent } from "react";

import type { LeadActionState } from "@/app/(app)/proyectos/[projectId]/leads/actions";
import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/proyectos/[projectId]/leads/sale-actions";
import { SaleModal } from "@/components/dashboard/sales/sale-modal";
import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  InstallmentRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtMoney } from "@/lib/format";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadRow, type LeadStatus } from "@/lib/leads/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { LeadFormModal } from "./lead-form-modal";

type MoveAction = (
  leadId: string,
  status: LeadStatus,
) => Promise<{ ok: true } | { error: string }>;

type UpdateAction = (
  leadId: string,
  prev: LeadActionState,
  formData: FormData,
) => Promise<LeadActionState>;

type DeleteAction = (leadId: string) => Promise<void>;

// ─── sales-related action types ───────────────────────────────────────────
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
type UpdateSaleProductAction = (
  saleId: string,
  productId: string,
  regenerate?: boolean,
) => Promise<{ ok: true } | { error: string }>;
type RecalculateSaleAction = (
  saleId: string,
) => Promise<{ ok: true } | { error: string }>;
type UpdateSaleAction = (
  saleId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type UpdatePaymentInstallmentAction = (
  paymentId: string,
  installmentId: string | null,
) => Promise<{ ok: true } | { error: string }>;
type UpdatePaymentMethodAction = (
  paymentId: string,
  paymentMethodId: string | null,
) => Promise<{ ok: true } | { error: string }>;
type AssignLeadOwnerAction = (
  leadId: string,
  teamMemberId: string | null,
) => Promise<{ ok: true } | { error: string }>;

/**
 * Tablero kanban del pipeline. Columnas = LEAD_STATUSES, ordenadas según el
 * orden canónico definido en `lib/leads/types`. Drag-and-drop usando HTML5
 * nativo — sin libs externas — porque las cards son livianas y el dataset es
 * chico (un proyecto típico no pasa de ~cientos de leads abiertos).
 *
 * El UPDATE optimista se aplica con `useOptimistic` para que el lead salte de
 * columna sin esperar al server. Si la action falla, React revierte al estado
 * del prop (el siguiente render desde el server pisa el optimistic).
 */
export function KanbanBoard({
  leads,
  teamMembers,
  launches,
  canEdit,
  moveAction,
  updateAction,
  deleteAction,
  // Sales 4b
  salesByLeadId,
  paymentsBySaleId,
  installmentsBySaleId,
  modalities,
  products,
  rules,
  paymentMethods,
  createSaleAction,
  addPaymentAction,
  deletePaymentAction,
  deleteSaleAction,
  updateSaleProductAction,
  recalculateSaleAction,
  updateSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
}: {
  readonly leads: ReadonlyArray<LeadRow>;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly canEdit: boolean;
  /** Server Action bound al projectId. Bindeamos por leadId en cada card. */
  readonly moveAction: MoveAction;
  readonly updateAction: UpdateAction;
  readonly deleteAction: DeleteAction;
  /**
   * Fase 8: cada lead puede tener N ventas (una por launch/producto). Se
   * apilan y el modal permite navegar entre ellas.
   */
  readonly salesByLeadId: ReadonlyMap<string, ReadonlyArray<SaleRow>>;
  readonly paymentsBySaleId: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  readonly installmentsBySaleId: ReadonlyMap<string, ReadonlyArray<InstallmentRow>>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly createSaleAction: CreateSaleAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction: DeleteSaleAction;
  readonly updateSaleProductAction: UpdateSaleProductAction;
  readonly recalculateSaleAction: RecalculateSaleAction;
  readonly updateSaleAction: UpdateSaleAction;
  readonly updatePaymentInstallmentAction: UpdatePaymentInstallmentAction;
  readonly updatePaymentMethodAction: UpdatePaymentMethodAction;
  readonly assignLeadOwnerAction: AssignLeadOwnerAction;
}) {
  const [, startTransition] = useTransition();
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(
    leads,
    (current, action: { id: string; status: LeadStatus }) =>
      current.map((l) => (l.id === action.id ? { ...l, status: action.status } : l)),
  );

  // Filtros client-side: el board ya tiene todos los leads pinned en memoria,
  // entonces el search + setter filter operan sobre `optimistic` antes de
  // bucketear. Sin round-trip al server, sin URL state — el caso de uso es
  // "buscar mientras trabajo el kanban", no compartir el filtro.
  const [query, setQuery] = useState("");
  const [setterFilter, setSetterFilter] = useState<"all" | "unassigned" | string>(
    "all",
  );

  const memberById = new Map(teamMembers.map((m) => [m.id, m]));
  const setters = teamMembers.filter((m) => m.role === "setter");

  // Rank por venta dentro de (member, launch). Se calcula sobre todas las
  // ventas que ve el board para que el tier marginal de cada card sea
  // consistente con el leaderboard.
  const allSales = Array.from(salesByLeadId.values()).flat();
  const rankBySaleId = buildSaleRanks(allSales);

  function handleDragStart(e: DragEvent<HTMLDivElement>, leadId: string) {
    e.dataTransfer.setData("text/plain", leadId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, status: LeadStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== status) setDragOverCol(status);
  }

  function handleDragLeave(status: LeadStatus) {
    if (dragOverCol === status) setDragOverCol(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, status: LeadStatus) {
    e.preventDefault();
    setDragOverCol(null);
    const leadId = e.dataTransfer.getData("text/plain");
    if (!leadId) return;
    const lead = optimistic.find((l) => l.id === leadId);
    if (!lead || lead.status === status) return;

    startTransition(async () => {
      setOptimistic({ id: leadId, status });
      await moveAction(leadId, status);
    });
  }

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (lead: LeadRow): boolean => {
    if (!normalizedQuery) return true;
    const haystacks = [
      lead.name,
      lead.contact,
      lead.phone_normalized,
      lead.email,
    ];
    for (const h of haystacks) {
      if (h && h.toLowerCase().includes(normalizedQuery)) return true;
    }
    return false;
  };
  const matchesSetter = (lead: LeadRow): boolean => {
    if (setterFilter === "all") return true;
    if (setterFilter === "unassigned") return lead.team_member_id === null;
    return lead.team_member_id === setterFilter;
  };

  const filtered = optimistic.filter(
    (lead) => matchesQuery(lead) && matchesSetter(lead),
  );

  const buckets: Record<LeadStatus, LeadRow[]> = {
    frio: [],
    tibio: [],
    agendado: [],
    cerrado: [],
    perdido: [],
  };
  for (const lead of filtered) buckets[lead.status].push(lead);

  const filtersActive =
    normalizedQuery !== "" || setterFilter !== "all";
  const totalCount = optimistic.length;
  const filteredCount = filtered.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/40 px-3 py-2">
        <input
          type="search"
          placeholder="Buscar por nombre, teléfono o email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[14rem] flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg placeholder:text-fg-subtle"
          aria-label="Buscar lead"
        />
        <select
          value={setterFilter}
          onChange={(e) => setSetterFilter(e.target.value)}
          className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-fg"
          aria-label="Filtrar por setter"
        >
          <option value="all">Todos los setters</option>
          <option value="unassigned">Sin asignar</option>
          {setters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {!s.active ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
        <span className="text-xs text-fg-subtle">
          {filtersActive
            ? `${filteredCount} de ${totalCount}`
            : `${totalCount} leads`}
        </span>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSetterFilter("all");
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
          >
            Limpiar
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
      {LEAD_STATUSES.map((status) => {
        const items = buckets[status];
        const isDragOver = dragOverCol === status;
        return (
          <div
            key={status}
            onDragOver={canEdit ? (e) => handleDragOver(e, status) : undefined}
            onDragLeave={canEdit ? () => handleDragLeave(status) : undefined}
            onDrop={canEdit ? (e) => handleDrop(e, status) : undefined}
            className={
              "flex w-72 shrink-0 flex-col rounded-md border bg-surface/40 " +
              (isDragOver ? "border-accent bg-accent/5" : "border-border")
            }
          >
            <header className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-fg">
                {LEAD_STATUS_LABELS[status]}
              </h2>
              <span className="text-xs text-fg-subtle">{items.length}</span>
            </header>
            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-fg-subtle">
                  Sin leads
                </p>
              ) : (
                items.map((lead) => {
                  const assignee = lead.team_member_id
                    ? memberById.get(lead.team_member_id)
                    : null;
                  // Fase 8: cada lead puede tener N ventas. Sumamos cobrado
                  // y comisión de todas para el preview de la card.
                  const leadSales = salesByLeadId.get(lead.id) ?? [];
                  let totalCollected = 0;
                  let totalCommission = 0;
                  for (const s of leadSales) {
                    const pays = paymentsBySaleId.get(s.id) ?? [];
                    const rule = findApplicableRule(
                      rules,
                      s.payment_modality_id,
                      s.launch_id,
                      s.product_id,
                    );
                    const b = computeCommission(
                      s,
                      pays,
                      rule,
                      rankBySaleId.get(s.id) ?? 0,
                    );
                    totalCollected += b.collected;
                    totalCommission += b.commission;
                  }
                  const hasSales = leadSales.length > 0;

                  return (
                    <div
                      key={lead.id}
                      draggable={canEdit}
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      className={
                        "rounded-md border border-border bg-bg-elevated p-3 text-sm " +
                        (canEdit ? "cursor-grab active:cursor-grabbing" : "")
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-fg">
                            {lead.name}
                          </div>
                          {lead.contact && (
                            <div className="mt-0.5 truncate text-xs text-fg-muted">
                              {lead.contact}
                            </div>
                          )}
                        </div>
                        {lead.source !== "manual" && (
                          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent">
                            {lead.source}
                          </span>
                        )}
                      </div>

                      {hasSales && (
                        <div className="mt-2 flex items-center justify-between rounded-md bg-surface/60 px-2 py-1 text-xs">
                          <span className="text-fg-subtle">
                            Cobrado {fmtMoney(totalCollected)}
                            {leadSales.length > 1 && (
                              <span className="ml-1 text-fg-muted">
                                · {leadSales.length} ventas
                              </span>
                            )}
                          </span>
                          <span className="font-medium text-accent">
                            +{fmtMoney(totalCommission)}
                          </span>
                        </div>
                      )}

                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-subtle">
                        <span className="truncate">
                          {assignee ? assignee.name : "Sin asignar"}
                        </span>
                        {canEdit && (
                          <div className="flex items-center gap-1">
                            <SaleModal
                              triggerLabel={
                                hasSales
                                  ? leadSales.length > 1
                                    ? `💰 ${leadSales.length}`
                                    : "💰"
                                  : "Venta"
                              }
                              triggerClassName={
                                hasSales
                                  ? "rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs text-accent hover:bg-accent/20"
                                  : "rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-fg hover:bg-bg-elevated"
                              }
                              lead={lead}
                              sales={leadSales}
                              saleRanks={rankBySaleId}
                              paymentsBySaleId={paymentsBySaleId}
                              installmentsBySaleId={installmentsBySaleId}
                              modalities={modalities}
                              products={products}
                              rules={rules}
                              paymentMethods={paymentMethods}
                              teamMembers={teamMembers}
                              createSaleAction={createSaleAction.bind(null, lead.id)}
                              updateProductAction={(saleId, productId) =>
                                updateSaleProductAction(saleId, productId)
                              }
                              recalculateAction={recalculateSaleAction}
                              updateSaleAction={updateSaleAction}
                              addPaymentAction={addPaymentAction}
                              deletePaymentAction={deletePaymentAction}
                              deleteSaleAction={deleteSaleAction}
                              updatePaymentInstallmentAction={
                                updatePaymentInstallmentAction
                              }
                              updatePaymentMethodAction={updatePaymentMethodAction}
                              assignLeadOwnerAction={
                                canEdit ? assignLeadOwnerAction : undefined
                              }
                            />
                            <LeadRowActions
                              lead={lead}
                              teamMembers={teamMembers}
                              launches={launches}
                              updateAction={updateAction.bind(null, lead.id)}
                              deleteAction={deleteAction.bind(null, lead.id)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function LeadRowActions({
  lead,
  teamMembers,
  launches,
  updateAction,
  deleteAction,
}: {
  readonly lead: LeadRow;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly updateAction: (
    prev: LeadActionState,
    formData: FormData,
  ) => Promise<LeadActionState>;
  readonly deleteAction: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <LeadFormModal
        triggerLabel="✎"
        triggerVariant="secondary"
        triggerClassName="!px-1.5 !py-0.5 !text-xs"
        title={`Editar ${lead.name}`}
        submitLabel="Guardar"
        action={updateAction}
        initial={lead}
        teamMembers={teamMembers}
        launches={launches}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`¿Borrar lead "${lead.name}"?`)) return;
          startTransition(async () => {
            await deleteAction();
          });
        }}
        aria-label="Borrar lead"
        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-error hover:bg-error/10 disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}
