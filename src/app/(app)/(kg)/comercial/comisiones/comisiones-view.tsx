"use client";

import { useState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import type {
  CommissionRuleRow,
  PaymentModalityRow,
} from "@/lib/commissions/types";
import type { ProductRow } from "@/lib/products/types";

import {
  deleteCommissionRule,
  deletePaymentModality,
  updateCommissionRule,
  updatePaymentModality,
  type CommissionActionState,
} from "./actions";
import { ModalityFormDrawer } from "./modality-form-drawer";
import { RuleFormDrawer } from "./rule-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista client de comisiones. Todo lo interactivo vive acá: apertura de
// drawers, confirmación de delete, toggle de estado. La page.tsx server
// hace el fetch y le pasa las rows.
//
// Server actions: NO se bindean desde la page server con arrow functions —
// Next.js rechaza cruzar closures no marcados `"use server"` al client. Las
// importamos directamente acá y las bindeamos con `.bind()` sobre la
// referencia serializable (la server action original). El caller server
// solo pasa el `projectId`, y este componente arma la binding curry-side.
// ═══════════════════════════════════════════════════════════════════════════

type FormActionSingle = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

export interface ComisionesViewProps {
  readonly projectId: string;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly createModalityAction: FormActionSingle;
  readonly createRuleAction: FormActionSingle;
}

export function ComisionesView({
  projectId,
  modalities,
  rules,
  launches,
  products,
  createModalityAction,
  createRuleAction,
}: ComisionesViewProps) {
  const [openCreateModality, setOpenCreateModality] = useState(false);
  const [editingModality, setEditingModality] =
    useState<PaymentModalityRow | null>(null);
  const [openCreateRule, setOpenCreateRule] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRuleRow | null>(
    null,
  );

  const modalityById = new Map(modalities.map((m) => [m.id, m]));
  const launchById = new Map(launches.map((l) => [l.id, l.name]));
  const productById = new Map(products.map((p) => [p.id, p.name]));
  const activeModalities = modalities.filter((m) => m.active);

  return (
    <>
      <Panel title="Modalidades de pago">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              Modalidades de pago disponibles al cargar una venta (contado,
              cuotas, etc.).
            </div>
            <button
              type="button"
              onClick={() => setOpenCreateModality(true)}
              className="kg-focus"
              style={primaryBtnSm}
            >
              + Nueva modalidad
            </button>
          </div>

          {modalities.length === 0 ? (
            <EmptyState
              title="Sin modalidades"
              hint='Cargá la primera (ej. "Pago total" o "3 cuotas").'
            />
          ) : (
            <div
              style={{
                borderRadius: "var(--kg-r-8)",
                border: "1px solid var(--kg-border-subtle)",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12.5,
                }}
              >
                <thead>
                  <tr>
                    <TH>Nombre</TH>
                    <TH>Estado</TH>
                    <TH align="right"></TH>
                  </tr>
                </thead>
                <tbody>
                  {modalities.map((m) => (
                    <ModalityRow
                      key={m.id}
                      modality={m}
                      projectId={projectId}
                      onEdit={() => setEditingModality(m)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Reglas de comisión">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              Cada regla puede aplicar a una o más modalidades, tiene tramos
              por cantidad de ventas, y un modo de devengamiento (proporcional
              o con umbral).
            </div>
            {activeModalities.length > 0 && (
              <button
                type="button"
                onClick={() => setOpenCreateRule(true)}
                className="kg-focus"
                style={primaryBtnSm}
              >
                + Nueva regla
              </button>
            )}
          </div>

          {activeModalities.length === 0 ? (
            <EmptyState
              title="Sin modalidades activas"
              hint="Necesitás al menos una modalidad activa antes de crear reglas."
            />
          ) : rules.length === 0 ? (
            <EmptyState
              title="Sin reglas configuradas"
              hint="Las ventas calculan comisión = 0 hasta que cargues la primera para esa modalidad."
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {rules.map((r) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  projectId={projectId}
                  modalityById={modalityById}
                  launchById={launchById}
                  productById={productById}
                  onEdit={() => setEditingRule(r)}
                />
              ))}
              <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                {fCount(rules.length)}{" "}
                {rules.length === 1 ? "regla" : "reglas"} configurada
                {rules.length === 1 ? "" : "s"}.
              </div>
            </div>
          )}
        </div>
      </Panel>

      <ModalityFormDrawer
        open={openCreateModality}
        onClose={() => setOpenCreateModality(false)}
        title="Nueva modalidad"
        submitLabel="Crear"
        action={createModalityAction}
      />

      {editingModality && (
        <ModalityFormDrawer
          open
          onClose={() => setEditingModality(null)}
          title={`Editar ${editingModality.name}`}
          submitLabel="Guardar"
          action={updatePaymentModality.bind(null, projectId, editingModality.id)}
          initial={editingModality}
        />
      )}

      <RuleFormDrawer
        open={openCreateRule}
        onClose={() => setOpenCreateRule(false)}
        title="Nueva regla de comisión"
        submitLabel="Crear"
        action={createRuleAction}
        modalities={modalities}
        launches={launches}
        products={products}
      />

      {editingRule && (
        <RuleFormDrawer
          open
          onClose={() => setEditingRule(null)}
          title="Editar regla de comisión"
          submitLabel="Guardar"
          action={updateCommissionRule.bind(null, projectId, editingRule.id)}
          modalities={modalities}
          launches={launches}
          products={products}
          initial={{
            modality_ids: editingRule.modality_ids,
            launch_id: editingRule.launch_id,
            product_id: editingRule.product_id,
            accrual_mode: editingRule.accrual_mode,
            threshold_type: editingRule.threshold_type,
            threshold_value: editingRule.threshold_value,
            tiers: editingRule.tiers.map((t) => ({
              min_count: t.min_count,
              max_count: t.max_count,
              type: t.type,
              value: t.value,
            })),
          }}
        />
      )}
    </>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────

function ModalityRow({
  modality,
  projectId,
  onEdit,
}: {
  readonly modality: PaymentModalityRow;
  readonly projectId: string;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (
      !confirm(
        `¿Borrar "${modality.name}"? Las reglas que la usan también se borran.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deletePaymentModality(projectId, modality.id);
    });
  }

  return (
    <tr
      className="kg-row"
      style={{ borderTop: "1px solid var(--kg-border-subtle)" }}
    >
      <TD style={{ fontWeight: 600, color: "var(--kg-text-1)" }}>
        {modality.name}
      </TD>
      <TD>
        <StatePill active={modality.active} />
      </TD>
      <TD align="right">
        <div
          style={{
            display: "inline-flex",
            gap: 6,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onEdit}
            className="kg-focus"
            style={ghostBtn}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="kg-focus"
            style={{ ...ghostBtn, color: "#EF4444", opacity: pending ? 0.6 : 1 }}
          >
            {pending ? "…" : "Borrar"}
          </button>
        </div>
      </TD>
    </tr>
  );
}

function RuleCard({
  rule,
  projectId,
  modalityById,
  launchById,
  productById,
  onEdit,
}: {
  readonly rule: CommissionRuleRow;
  readonly projectId: string;
  readonly modalityById: ReadonlyMap<string, PaymentModalityRow>;
  readonly launchById: ReadonlyMap<string, string>;
  readonly productById: ReadonlyMap<string, string>;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const modalityNames = rule.modality_ids
    .map((id) => modalityById.get(id)?.name ?? "—")
    .join(", ");
  const scopeLabel = rule.product_id
    ? `Producto: ${productById.get(rule.product_id) ?? "—"}`
    : rule.launch_id
      ? `Launch: ${launchById.get(rule.launch_id) ?? "—"}`
      : "Default del proyecto";

  function handleDelete() {
    if (!confirm("¿Borrar esta regla?")) return;
    startTransition(async () => {
      await deleteCommissionRule(projectId, rule.id);
    });
  }

  return (
    <article
      style={{
        borderRadius: "var(--kg-r-8)",
        border: "1px solid var(--kg-border-subtle)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid var(--kg-border-subtle)",
          background: "var(--kg-surface-2-solid)",
          padding: "10px 14px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--kg-text-1)",
            }}
          >
            {modalityNames || "Sin modalidades"}
          </div>
          <div
            className="kg-t7"
            style={{
              color: "var(--kg-text-3)",
              marginTop: 3,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span>{scopeLabel}</span>
            <span>·</span>
            <span>{accrualLabel(rule)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            onClick={onEdit}
            className="kg-focus"
            style={ghostBtn}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="kg-focus"
            style={{
              ...ghostBtn,
              color: "#EF4444",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "…" : "Borrar"}
          </button>
        </div>
      </header>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              <TH small>Tramo</TH>
              <TH small>Desde</TH>
              <TH small>Hasta</TH>
              <TH small>Tipo</TH>
              <TH small align="right">
                Valor
              </TH>
            </tr>
          </thead>
          <tbody>
            {rule.tiers.map((t, i) => (
              <tr
                key={t.id}
                style={{ borderTop: "1px solid var(--kg-border-subtle)" }}
              >
                <TD style={{ color: "var(--kg-text-3)" }}>#{i + 1}</TD>
                <TD numeric>venta {t.min_count + 1}</TD>
                <TD numeric>
                  {t.max_count === null ? "∞" : `venta ${t.max_count + 1}`}
                </TD>
                <TD style={{ color: "var(--kg-text-3)" }}>
                  {t.type === "percent" ? "%" : "$ fijo"}
                </TD>
                <TD numeric align="right">
                  {t.type === "percent" ? `${t.value}%` : `$${t.value}`}
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function StatePill({ active }: { readonly active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: active
          ? "rgba(0,208,132,0.15)"
          : "rgba(138,138,153,0.15)",
        color: active ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: active ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {active ? "Activa" : "Inactiva"}
    </span>
  );
}

// TH / TD helpers — mismo estilo que KgDataTable pero sin la lógica de columns
// (necesario acá porque la tabla tiene estructura ad-hoc).

function TH({
  children,
  align,
  small,
}: {
  readonly children?: React.ReactNode;
  readonly align?: "left" | "right" | "center";
  readonly small?: boolean;
}) {
  return (
    <th
      scope="col"
      style={{
        textAlign: align ?? "left",
        padding: small ? "8px 12px" : "10px 14px",
        borderBottom: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-3)",
        fontWeight: 600,
        fontSize: small ? 10.5 : 11,
        letterSpacing: 0.2,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        background: "transparent",
      }}
    >
      {children}
    </th>
  );
}

function TD({
  children,
  align,
  numeric,
  style,
}: {
  readonly children?: React.ReactNode;
  readonly align?: "left" | "right" | "center";
  readonly numeric?: boolean;
  readonly style?: React.CSSProperties;
}) {
  return (
    <td
      className={numeric ? "kg-num" : undefined}
      style={{
        textAlign: align ?? "left",
        padding: "8px 14px",
        color: "var(--kg-text-1)",
        fontVariantNumeric: numeric ? "tabular-nums" : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function accrualLabel(r: {
  accrual_mode:
    | "proportional"
    | "threshold_full"
    | "threshold_proportional"
    | "on_close";
  threshold_type: "payment_count" | "paid_ratio" | null;
  threshold_value: number | null;
}): string {
  if (r.accrual_mode === "on_close") return "Se libera al cerrar la venta";
  if (r.accrual_mode === "proportional") return "A medida que entra plata";
  const cond =
    r.threshold_type === "payment_count"
      ? `${r.threshold_value} cobros`
      : `${Math.round((r.threshold_value ?? 0) * 100)}% cobrado`;
  if (r.accrual_mode === "threshold_full") {
    return `Al juntar ${cond} → paga el total`;
  }
  return `Al juntar ${cond} → proporcional al cobrado`;
}

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const primaryBtnSm: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
