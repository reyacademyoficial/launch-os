"use client";

import { useOptimistic, useState, useTransition } from "react";

import type { LeadActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/leads/actions";
import type {
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { SaleModal } from "@/components/dashboard/sales/sale-modal";
import { KgConfirmDialog } from "@/components/kg/confirm-dialog";
import {
  dangerBtn,
  inputStyle,
  smallBtn,
} from "@/components/kg/form-primitives";
import { KgKanban } from "@/components/kg/kanban";
import { StatusPill } from "@/components/kg/status-pill";
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
import {
  fmtNative,
  fmtUsd,
  normalizePaymentsForSaleCurrency,
  type FxLookup,
} from "@/lib/money";
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
 * orden canónico definido en `lib/leads/types`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN AL DESIGN SYSTEM KG
 * ───────────────────────────────────────────────────────────────────────────
 * El chasis del board (columnas, headers, drop-zones, cards arrastrables,
 * carrusel en mobile) salió de acá y vive en `@/components/kg/kanban`. Este
 * archivo se quedó SÓLO con lo que es de leads: filtros, cálculo de comisión
 * por card y los modales de venta/edición.
 *
 * Lo que NO cambió, a propósito:
 *   - Los props públicos: `leads/page.tsx` los pasa igual que siempre.
 *   - El drag & drop sigue siendo HTML5 nativo (ahora dentro de `KgKanban`),
 *     con el mismo dataTransfer "text/plain".
 *   - El update optimista sigue acá, con `useOptimistic`: el lead salta de
 *     columna sin esperar al server y si la action falla React revierte al
 *     estado del prop. `KgKanban` es una primitiva CONTROLADA justamente para
 *     que esta pieza no se mueva de lugar (ver su cabecera).
 *   - Los gates de permisos: `canEdit` decide si `onMove` existe (sin él el
 *     board es de sólo lectura) y si se muestran las acciones por card.
 *
 * Lo que sí cambió, y por qué:
 *   - La comisión ya no se pinta de acento. LA PLATA NO SE PINTA (`tone.ts`):
 *     el "+" delante del número es la única señal de dirección que necesita,
 *     igual que el signo menos en las tablas.
 *   - La pill de `source` pasó a `StatusPill` (dot neutro + texto), en vez del
 *     chip con fondo tintado que hacía efecto semáforo junto al resto.
 *   - El `confirm()` nativo del borrado pasó a `KgConfirmDialog`.
 *   - El filtro de setter queda como `<select>` nativo con `inputStyle` y NO
 *     como `KgFilterSelect`: `KgFilterSelect` navega por URL, y este filtro
 *     vive en estado LOCAL a propósito (ver nota abajo).
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
  invoicesBySaleId,
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
  fxLookup,
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
  readonly invoicesBySaleId: ReadonlyMap<
    string,
    ReadonlyArray<{
      readonly id: string;
      readonly invoice_number: string | null;
      readonly installment_id: string | null;
      readonly amount_gross: number;
      readonly status: string;
    }>
  >;
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
  /**
   * Lookup FX opcional. Con fxLookup, los "Cobrado" y "Comisión" por card
   * salen en moneda nativa de cada sale; sin fxLookup, fallback a fmtMoney
   * legacy.
   */
  readonly fxLookup?: FxLookup;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    leads,
    (current, action: { id: string; status: LeadStatus }) =>
      current.map((l) => (l.id === action.id ? { ...l, status: action.status } : l)),
  );

  // Filtros client-side: el board ya tiene todos los leads pinned en memoria,
  // entonces el search + setter filter operan sobre `optimistic` antes de
  // bucketear. Sin round-trip al server, sin URL state — el caso de uso es
  // "buscar mientras trabajo el kanban", no compartir el filtro. Por eso el
  // select va nativo con `inputStyle` y no con `KgFilterSelect`, que navega.
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

  const filtersActive = normalizedQuery !== "" || setterFilter !== "all";
  const totalCount = optimistic.length;
  const filteredCount = filtered.length;

  /**
   * Movimiento de columna. `KgKanban` infiere el tipo del id de columna desde
   * `columnOf`, así que `status` llega tipado como `LeadStatus` — no hace
   * falta validar nada acá. La primitiva ya descartó los no-movimientos
   * (misma columna, id desconocido).
   */
  function handleMove(leadId: string, status: LeadStatus) {
    startTransition(async () => {
      setOptimistic({ id: leadId, status });
      await moveAction(leadId, status);
    });
  }

  const toolbar = (
    <div
      className="kg-glass"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--kg-r-16)",
      }}
    >
      <input
        type="search"
        placeholder="Buscar por nombre, teléfono o email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar lead"
        className="kg-focus"
        style={{
          ...inputStyle,
          width: "auto",
          flex: "1 1 14rem",
          minWidth: "12rem",
          minHeight: 36,
        }}
      />
      <select
        value={setterFilter}
        onChange={(e) => setSetterFilter(e.target.value)}
        aria-label="Filtrar por setter"
        className="kg-focus"
        style={{
          ...inputStyle,
          width: "auto",
          minHeight: 36,
          cursor: "pointer",
        }}
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
      <span
        className="kg-num"
        style={{ color: "var(--kg-text-3)", fontSize: 11 }}
      >
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
          className="kg-focus"
          style={{ ...smallBtn, minHeight: 36 }}
        >
          Limpiar
        </button>
      )}
    </div>
  );

  /**
   * Contenido de la card. El chasis (borde, fondo, asa de arrastre, foco) lo
   * pone `KgKanban`; acá va sólo lo que es de un lead.
   */
  function renderLeadCard(lead: LeadRow) {
    const assignee = lead.team_member_id
      ? memberById.get(lead.team_member_id)
      : null;
    // Fase 8: cada lead puede tener N ventas. Sumamos cobrado y comisión de
    // todas para el preview de la card.
    const leadSales = salesByLeadId.get(lead.id) ?? [];
    // Con fxLookup: si todos los sales del lead son la misma moneda nativa,
    // mostramos el total en esa moneda; si son mixed, convertimos a USD para
    // no mezclar. Sin fxLookup: legacy suma cruda.
    let uniformCurrency: "ARS" | "USD" | null = null;
    if (fxLookup) {
      for (const s of leadSales) {
        const c = fxLookup.bySaleId[s.id]?.currency ?? "USD";
        if (uniformCurrency === null) uniformCurrency = c;
        else if (uniformCurrency !== c) {
          uniformCurrency = null;
          break;
        }
      }
    }
    const displayInUsd = fxLookup != null && uniformCurrency == null;
    let totalCollected = 0;
    // Comisiones acumuladas por moneda — el tier fixed lleva moneda propia
    // (0107) y el usuario pidió no convertir.
    let commissionArs = 0;
    let commissionUsd = 0;
    for (const s of leadSales) {
      const pays = paymentsBySaleId.get(s.id) ?? [];
      const rule = findApplicableRule(
        rules,
        s.payment_modality_id,
        s.launch_id,
        s.product_id,
      );
      // Normalizar payments a la moneda del sale antes del calc — el ratio
      // collected/pledged asume unidades homogéneas.
      // TODO(ui): pintar warning cuando hasMixed.
      const { normalized } = normalizePaymentsForSaleCurrency(s, pays, fxLookup);
      const b = computeCommission(
        s,
        normalized,
        rule,
        rankBySaleId.get(s.id) ?? 0,
      );
      if (displayInUsd && fxLookup) {
        const saleUsd = fxLookup.bySaleId[s.id]?.totalUsd ?? null;
        const saleTotal = Number(s.total_amount) || 0;
        const scale =
          saleUsd !== null && saleTotal > 0 ? saleUsd / saleTotal : 1;
        totalCollected += b.collected * scale;
      } else {
        totalCollected += b.collected;
      }
      if (b.commissionCurrency === "USD") commissionUsd += b.commission;
      else commissionArs += b.commission;
    }
    const hasSales = leadSales.length > 0;
    const fmtCardMoney = fxLookup
      ? displayInUsd
        ? (n: number) => fmtUsd(n)
        : (n: number) => fmtNative(n, uniformCurrency ?? "USD")
      : (n: number) => fmtMoney(n);
    const commissionText =
      commissionArs > 0 && commissionUsd > 0
        ? `+${fmtNative(commissionArs, "ARS")} · +${fmtNative(commissionUsd, "USD")}`
        : commissionUsd > 0
          ? `+${fmtNative(commissionUsd, "USD")}`
          : `+${fmtNative(commissionArs, "ARS")}`;

    return (
      <>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="kg-t5"
              style={{
                color: "var(--kg-text-1)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {lead.name}
            </div>
            {lead.contact && (
              <div
                style={{
                  marginTop: 2,
                  color: "var(--kg-text-3)",
                  fontSize: 11,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {lead.contact}
              </div>
            )}
          </div>
          {/* `source` es una marca categórica, no un estado: dot neutro. */}
          {lead.source !== "manual" && <StatusPill text={lead.source} />}
        </div>

        {hasSales && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "6px 8px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-1)",
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--kg-text-3)", minWidth: 0 }}>
              Cobrado{" "}
              <span className="kg-num" style={{ color: "var(--kg-text-2)" }}>
                {fmtCardMoney(totalCollected)}
              </span>
              {leadSales.length > 1 && <> · {leadSales.length} ventas</>}
            </span>
            {/*
              LA PLATA NO SE PINTA: la comisión ya no va en color de acento.
              El "+" alcanza como señal de dirección.
            */}
            <span
              className="kg-num"
              style={{
                color: "var(--kg-text-1)",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {commissionText}
            </span>
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 11,
            color: "var(--kg-text-3)",
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {assignee ? assignee.name : "Sin asignar"}
          </span>
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <SaleModal
                triggerLabel={
                  hasSales
                    ? leadSales.length > 1
                      ? `💰 ${leadSales.length}`
                      : "💰"
                    : "Venta"
                }
                triggerClassName={
                  hasSales ? SALE_TRIGGER_ACTIVE_CLASS : SALE_TRIGGER_CLASS
                }
                lead={lead}
                sales={leadSales}
                saleRanks={rankBySaleId}
                paymentsBySaleId={paymentsBySaleId}
                installmentsBySaleId={installmentsBySaleId}
                invoicesBySaleId={invoicesBySaleId}
                modalities={modalities}
                products={products}
                rules={rules}
                paymentMethods={paymentMethods}
                teamMembers={teamMembers}
                launches={launches}
                createSaleAction={createSaleAction.bind(null, lead.id)}
                updateProductAction={(saleId, productId) =>
                  updateSaleProductAction(saleId, productId)
                }
                recalculateAction={recalculateSaleAction}
                updateSaleAction={updateSaleAction}
                addPaymentAction={addPaymentAction}
                deletePaymentAction={deletePaymentAction}
                deleteSaleAction={deleteSaleAction}
                updatePaymentInstallmentAction={updatePaymentInstallmentAction}
                updatePaymentMethodAction={updatePaymentMethodAction}
                assignLeadOwnerAction={canEdit ? assignLeadOwnerAction : undefined}
                fxLookup={fxLookup}
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
      </>
    );
  }

  return (
    <KgKanban
      items={filtered}
      itemKey={(lead) => lead.id}
      columnOf={(lead) => lead.status}
      itemLabel={(lead) => lead.name}
      columns={LEAD_STATUSES.map((status) => ({
        id: status,
        label: LEAD_STATUS_LABELS[status],
      }))}
      emptyText="Sin leads"
      ariaLabel="Pipeline de leads"
      toolbar={toolbar}
      // Sin permiso de edición no hay `onMove`: la primitiva apaga drag, drop
      // y teclado de una sola vez. Mismo gate que tenía el board a mano.
      onMove={canEdit ? handleMove : undefined}
      renderItem={renderLeadCard}
    />
  );
}

/**
 * `SaleModal` (se migra en una etapa posterior) sólo acepta `triggerClassName`
 * — no `style` — y reemplaza sus clases por completo. Hasta que se migre, el
 * único vehículo para los tokens `--kg-*` es Tailwind con valores arbitrarios.
 * Es la excepción documentada a la regla de inline styles: en cuanto SaleModal
 * exponga `triggerStyle`, esto pasa a `smallBtn`.
 */
const SALE_TRIGGER_CLASS =
  "kg-focus inline-flex min-h-9 items-center gap-1 rounded-full border " +
  "border-[var(--kg-border-subtle)] bg-transparent px-2.5 text-[11px] " +
  "font-semibold text-[var(--kg-text-2)]";

/** Variante con borde de acento cuando el lead ya tiene ventas cargadas. */
const SALE_TRIGGER_ACTIVE_CLASS =
  "kg-focus inline-flex min-h-9 items-center gap-1 rounded-full border " +
  "border-[var(--kg-border-accent)] bg-transparent px-2.5 text-[11px] " +
  "font-semibold text-[var(--kg-accent-text)]";

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
  const [askDelete, setAskDelete] = useState(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {/*
        El trigger sigue siendo el `Button` legacy de `lead-form-modal.tsx`,
        que se migra en otra etapa y sólo acepta className. Se deja tal cual
        para no cambiarle el render mientras tanto.
      */}
      <LeadFormModal
        triggerLabel="✎"
        triggerVariant="secondary"
        triggerClassName="kg-focus !px-1.5 !py-0.5 !text-xs"
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
        onClick={() => setAskDelete(true)}
        aria-label="Borrar lead"
        className="kg-focus"
        style={{
          ...dangerBtn,
          padding: "0 10px",
          minHeight: 36,
          opacity: isPending ? 0.5 : 1,
        }}
      >
        ×
      </button>
      <KgConfirmDialog
        open={askDelete}
        onClose={() => setAskDelete(false)}
        title="Borrar lead"
        description={
          <>
            Vas a borrar{" "}
            <b style={{ color: "var(--kg-text-1)" }}>{lead.name}</b>. Esta
            acción no se puede deshacer.
          </>
        }
        confirmLabel="Borrar"
        pendingLabel="Borrando…"
        pending={isPending}
        onConfirm={() => {
          startTransition(async () => {
            await deleteAction();
          });
        }}
      />
    </div>
  );
}
