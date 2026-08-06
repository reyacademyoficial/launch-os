"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";
import { fMoney } from "@/lib/finance/format";

import {
  createInvoice,
  updateInvoice,
  voidInvoice,
  type CreateInvoiceState,
  type UpdateInvoiceState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer compartido create / edit para invoices manuales.
//
// Numeración NO se elige — la asigna next_invoice_number(org) desde el server.
// En create se muestra "se asignará al guardar"; en edit se muestra fijo
// (invoice_number no se toca por update — ver actions.ts).
//
// Anular: sólo en edit. Confirmación nativa; el server rechaza si status ya
// es 'cobrada' o 'anulada'.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface ProductOption {
  readonly id: string;
  readonly name: string;
  readonly projectId: string | null;
}

export interface InvoiceInitial {
  readonly id?: string;
  readonly invoiceNumber?: string | null;
  readonly status?: "emitida" | "cobrada" | "vencida" | "anulada";
  readonly projectId?: string | null;
  readonly saleId?: string | null;
  readonly productId?: string | null;
  readonly description?: string;
  readonly category?: string | null;
  readonly amountGross?: number;
  readonly taxAmount?: number;
  readonly currency?: string;
  readonly issueDate?: string;
  readonly dueDate?: string | null;
  readonly purchaseDate?: string | null;
  readonly buyerName?: string | null;
  readonly buyerEmail?: string | null;
  readonly buyerDocument?: string | null;
  readonly transactionNumber?: string | null;
  readonly notes?: string | null;
}

export interface InvoiceFormDrawerProps {
  readonly mode: "create" | "edit";
  readonly initial?: InvoiceInitial;
  readonly projects: readonly ProjectOption[];
  readonly products: readonly ProductOption[];
  readonly open: boolean;
  readonly onClose: () => void;
}

export function InvoiceFormDrawer(props: InvoiceFormDrawerProps) {
  if (!props.open) return null;
  const title = props.mode === "create" ? "Nueva factura" : "Editar factura";
  const subtitle =
    props.mode === "edit" && props.initial?.invoiceNumber
      ? `Nº ${props.initial.invoiceNumber}`
      : undefined;
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle={subtitle}
      width={620}
    >
      <FormBody {...props} />
    </Drawer>
  );
}

function FormBody({
  mode,
  initial,
  projects,
  products,
  onClose,
}: InvoiceFormDrawerProps) {
  const isEdit = mode === "edit" && !!initial?.id;

  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id!;
    return async (prev: UpdateInvoiceState, fd: FormData) =>
      updateInvoice(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] =
    useActionState<CreateInvoiceState, FormData>(createInvoice, null);
  const [updateState, updateFormAction, updatePending] =
    useActionState<UpdateInvoiceState, FormData>(
      updateBound ??
        (async () => ({ error: "Modo edit sin id" as string }) as never),
      null,
    );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidPending, startVoid] = useTransition();

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  // Validación cliente-side: IVA vs bruto (espeja invoices_tax_within_gross).
  const [amountGrossStr, setAmountGrossStr] = useState<string>(
    initial?.amountGross != null ? String(initial.amountGross) : "",
  );
  const [taxAmountStr, setTaxAmountStr] = useState<string>(
    initial?.taxAmount != null ? String(initial.taxAmount) : "0",
  );
  const amountGross = Number(amountGrossStr);
  const taxAmount = Number(taxAmountStr);
  const taxTooHigh =
    Number.isFinite(amountGross) &&
    Number.isFinite(taxAmount) &&
    taxAmount > amountGross;
  const amountNet =
    Number.isFinite(amountGross) && Number.isFinite(taxAmount)
      ? amountGross - taxAmount
      : null;

  // Filtro de productos por proyecto elegido — reactivo local.
  const [projectId, setProjectId] = useState<string>(initial?.projectId ?? "");
  const productsForProject = projectId
    ? products.filter((p) => p.projectId === projectId)
    : products;

  function handleVoid() {
    if (!isEdit) return;
    const id = initial!.id!;
    if (
      !confirm(
        "¿Anular esta factura? Se preserva el registro con estado 'anulada'. No se puede deshacer.",
      )
    ) {
      return;
    }
    setVoidError(null);
    startVoid(async () => {
      const r = await voidInvoice(id);
      if ("error" in r) {
        setVoidError(r.error);
        return;
      }
      onClose();
    });
  }

  const submitLabel = mode === "create" ? "Crear factura" : "Guardar cambios";
  const isVoided = initial?.status === "anulada";
  const isCollected = initial?.status === "cobrada";

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {mode === "create" && (
        <div
          className="kg-t7"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(64,120,255,0.10)",
            border: "1px solid rgba(64,120,255,0.3)",
            color: "var(--kg-text-2)",
          }}
        >
          El número de factura se asigna al guardar (talonario único por
          organización, empieza en 0000001).
        </div>
      )}

      {isEdit && (isVoided || isCollected) && (
        <div
          className="kg-t7"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--kg-r-8)",
            background: isVoided
              ? "rgba(239,68,68,0.10)"
              : "rgba(0,208,132,0.10)",
            color: isVoided ? "#EF4444" : "#00D084",
          }}
        >
          {isVoided
            ? "Factura anulada — se puede editar la descripción/comprador pero no reversar."
            : "Factura cobrada — para revertir, desvinculá primero el cobro asociado."}
        </div>
      )}

      <Field label="Descripción" htmlFor="description" required>
        <input
          id="description"
          name="description"
          type="text"
          required
          defaultValue={initial?.description ?? ""}
          placeholder="Ej. Retainer agosto — Maestro Charcutero"
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      <Field label="Categoría" htmlFor="category">
        <input
          id="category"
          name="category"
          type="text"
          defaultValue={initial?.category ?? ""}
          placeholder="Opcional (retainer, honorarios, venta…)"
          style={inputStyle}
        />
      </Field>

      <Field label="Proyecto" htmlFor="project_id">
        <select
          id="project_id"
          name="project_id"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          style={inputStyle}
        >
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Producto" htmlFor="product_id">
        <select
          id="product_id"
          name="product_id"
          defaultValue={initial?.productId ?? ""}
          style={inputStyle}
        >
          <option value="">Sin producto</option>
          {productsForProject.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Monto bruto" htmlFor="amount_gross" required>
          <input
            id="amount_gross"
            name="amount_gross"
            type="number"
            step="0.01"
            min="0"
            required
            value={amountGrossStr}
            onChange={(e) => setAmountGrossStr(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </Field>
        <Field label="IVA" htmlFor="tax_amount">
          <input
            id="tax_amount"
            name="tax_amount"
            type="number"
            step="0.01"
            min="0"
            value={taxAmountStr}
            onChange={(e) => setTaxAmountStr(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </Field>
      </div>

      {amountNet != null && (
        <div
          className="kg-t7"
          style={{ color: taxTooHigh ? "#EF4444" : "var(--kg-text-3)" }}
        >
          {taxTooHigh
            ? `El IVA (${fMoney(taxAmount)}) supera el bruto (${fMoney(amountGross)}).`
            : `Neto: ${fMoney(amountNet)}`}
        </div>
      )}

      <Field label="Moneda" htmlFor="currency">
        <select
          id="currency"
          name="currency"
          defaultValue={initial?.currency ?? "ARS"}
          style={inputStyle}
        >
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </Field>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
        }}
      >
        <Field label="Emisión" htmlFor="issue_date" required>
          <input
            id="issue_date"
            name="issue_date"
            type="date"
            required
            defaultValue={initial?.issueDate ?? todayYmd()}
            style={inputStyle}
          />
        </Field>
        <Field label="Vencimiento" htmlFor="due_date">
          <input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={initial?.dueDate ?? ""}
            style={inputStyle}
          />
        </Field>
        <Field label="Compra" htmlFor="purchase_date">
          <input
            id="purchase_date"
            name="purchase_date"
            type="date"
            defaultValue={initial?.purchaseDate ?? ""}
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Comprador" htmlFor="buyer_name">
          <input
            id="buyer_name"
            name="buyer_name"
            type="text"
            defaultValue={initial?.buyerName ?? ""}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
        <Field label="Email comprador" htmlFor="buyer_email">
          <input
            id="buyer_email"
            name="buyer_email"
            type="email"
            defaultValue={initial?.buyerEmail ?? ""}
            placeholder="Opcional"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Documento comprador" htmlFor="buyer_document">
        <input
          id="buyer_document"
          name="buyer_document"
          type="text"
          defaultValue={initial?.buyerDocument ?? ""}
          placeholder="Opcional (CUIT / DNI)"
          style={inputStyle}
        />
      </Field>

      <Field label="Nº de transacción" htmlFor="transaction_number">
        <input
          id="transaction_number"
          name="transaction_number"
          type="text"
          defaultValue={initial?.transactionNumber ?? ""}
          placeholder="Opcional (para conciliar con movimiento del banco)"
          style={inputStyle}
        />
      </Field>

      <Field label="Notas" htmlFor="notes">
        <input
          id="notes"
          name="notes"
          type="text"
          defaultValue={initial?.notes ?? ""}
          placeholder="Opcional"
          style={inputStyle}
        />
      </Field>

      {((state && "error" in state) || voidError) && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {voidError ?? (state as { error: string }).error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: isEdit ? "space-between" : "flex-end",
          gap: 8,
          marginTop: 4,
          alignItems: "center",
        }}
      >
        {isEdit && !isVoided && !isCollected && (
          <button
            type="button"
            onClick={handleVoid}
            disabled={pending || voidPending}
            className="kg-focus"
            style={{
              ...secondaryBtn,
              color: "#EF4444",
              borderColor: "#EF4444",
              opacity: pending || voidPending ? 0.6 : 1,
            }}
            title="Anular factura"
          >
            {voidPending ? "Anulando…" : "Anular"}
          </button>
        )}
        <div style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending || voidPending}
            className="kg-focus"
            style={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || voidPending || taxTooHigh}
            className="kg-focus"
            style={{
              ...primaryBtn,
              opacity: pending || taxTooHigh ? 0.7 : 1,
            }}
          >
            {pending
              ? mode === "create"
                ? "Creando…"
                : "Guardando…"
              : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="kg-t7"
        style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#EF4444", marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
