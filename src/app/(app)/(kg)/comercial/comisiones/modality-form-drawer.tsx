"use client";

import { useActionState, useEffect } from "react";

import { Drawer } from "@/components/kg/drawer";
import type { PaymentModalityRow } from "@/lib/commissions/types";

import type { CommissionActionState } from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer create / edit de payment_modality. Estilo KG puro (Drawer,
// inputStyle inline, primaryBtn/secondaryBtn). Sustituye a modality-form +
// modality-modal que venían con Tailwind LaunchOS.
//
// La `action` viene curriada desde la page con el projectId — mismo patrón
// que rotate-rule, expense-form, bank-form.
// ═══════════════════════════════════════════════════════════════════════════

type FormAction = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

export interface ModalityFormDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: PaymentModalityRow;
}

export function ModalityFormDrawer({
  open,
  onClose,
  title,
  submitLabel,
  action,
  initial,
}: ModalityFormDrawerProps) {
  if (!open) return null;
  return (
    <Drawer open={open} onClose={onClose} title={title} width={440}>
      <FormBody
        action={action}
        initial={initial}
        submitLabel={submitLabel}
        onClose={onClose}
      />
    </Drawer>
  );
}

function FormBody({
  action,
  initial,
  submitLabel,
  onClose,
}: {
  readonly action: FormAction;
  readonly initial?: PaymentModalityRow;
  readonly submitLabel: string;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    CommissionActionState,
    FormData
  >(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Nombre" htmlFor="mod-name" required>
        <input
          id="mod-name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name ?? ""}
          placeholder='Ej. "Pago total", "3 cuotas"'
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      {initial && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--kg-text-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            style={{ accentColor: "var(--kg-accent-500)" }}
          />
          Activa
        </label>
      )}

      {state && "error" in state && (
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
          {state.error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
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
