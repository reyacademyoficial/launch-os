"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/kg/drawer";
import { fMoney } from "@/lib/finance/format";

import {
  createPayroll,
  updatePayroll,
  type CreatePayrollState,
  type UpdatePayrollState,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Drawer para crear o editar una liquidación de nómina.
//
// Flujo típico (create):
//   1) Elegí a la persona → base_salary y currency se autocompletan desde el
//      perfil (organization_people.monthly_salary, salary_currency).
//   2) Ajustá el período (default: mes-actual, día 1 → último día).
//   3) Sumá extras si los hay (aguinaldo, bono, descuento). Un extra con
//      monto negativo es un descuento (retención, adelanto, etc.).
//   4) Total = base + Σ extras (calculado en vivo).
//   5) Guardá → row impaga → aparece como cuenta por pagar en el dashboard
//      financiero hasta que la marques como pagada.
//
// Edit: prepobla con `initial`, llama a `updatePayroll` bindeado con el
// payrollId. NO auto-piso base/currency al cambiar de persona en edit — si
// el operador cambió a mano, respetamos.
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonOption {
  readonly id: string;
  readonly full_name: string;
  readonly monthly_salary: number;
  readonly salary_currency: "ARS" | "USD";
}

export interface PayrollInitial {
  readonly id: string;
  readonly personId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseSalary: number;
  /** Serializado como {label: amount} — misma forma que jsonb `extras`. */
  readonly extras: Record<string, number>;
  readonly currency: "ARS" | "USD";
  readonly dueDate: string | null;
  readonly notes: string | null;
}

interface ExtraRow {
  readonly id: number; // key local, no viaja al server
  readonly label: string;
  readonly amount: string; // string para permitir "-" mientras tipea
}

export function PayrollFormDrawer({
  mode,
  open,
  onClose,
  people,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly people: ReadonlyArray<PersonOption>;
  readonly initial?: PayrollInitial;
}) {
  if (!open) return null;
  const title = mode === "create" ? "Nueva liquidación" : "Editar liquidación";
  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      <PayrollFormBody
        mode={mode}
        people={people}
        onClose={onClose}
        initial={initial}
      />
    </Drawer>
  );
}

function PayrollFormBody({
  mode,
  people,
  onClose,
  initial,
}: {
  readonly mode: "create" | "edit";
  readonly people: ReadonlyArray<PersonOption>;
  readonly onClose: () => void;
  readonly initial?: PayrollInitial;
}) {
  const isEdit = mode === "edit" && initial != null;

  // Bindeo del updatePayroll con el id — useMemo para que la referencia sea
  // estable y useActionState no reinicialice.
  const updateBound = useMemo(() => {
    if (!isEdit) return null;
    const id = initial!.id;
    return async (prev: UpdatePayrollState, fd: FormData) =>
      updatePayroll(id, prev, fd);
  }, [isEdit, initial]);

  const [createState, createFormAction, createPending] = useActionState<
    CreatePayrollState,
    FormData
  >(createPayroll, null);
  const [updateState, updateFormAction, updatePending] = useActionState<
    UpdatePayrollState,
    FormData
  >(
    updateBound ??
      (async () => ({ error: "Modo edit sin id" as string }) as never),
    null,
  );

  const state = isEdit ? updateState : createState;
  const formAction = isEdit ? updateFormAction : createFormAction;
  const pending = isEdit ? updatePending : createPending;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onClose();
  }, [state, onClose]);

  // Defaults: edit → initial; create → primera persona activa.
  const [personId, setPersonId] = useState<string>(
    initial?.personId ?? people[0]?.id ?? "",
  );

  const initialPeriod = useMemo(() => monthBoundsToday(), []);
  const [periodStart, setPeriodStart] = useState(
    initial?.periodStart ?? initialPeriod.start,
  );
  const [periodEnd, setPeriodEnd] = useState(
    initial?.periodEnd ?? initialPeriod.end,
  );

  const [baseSalary, setBaseSalary] = useState<string>(
    initial != null
      ? String(initial.baseSalary)
      : people[0]?.monthly_salary != null
        ? String(people[0].monthly_salary)
        : "0",
  );
  const [currency, setCurrency] = useState<"ARS" | "USD">(
    initial?.currency ?? people[0]?.salary_currency ?? "ARS",
  );

  // Solo en create autopoblamos base/currency al cambiar de persona. En edit,
  // respetamos lo que el operador guardó — cambiar persona no debería pisar
  // un total ya calculado.
  function handlePersonChange(nextId: string) {
    setPersonId(nextId);
    if (isEdit) return;
    const next = people.find((p) => p.id === nextId);
    if (next) {
      setBaseSalary(String(next.monthly_salary));
      setCurrency(next.salary_currency);
    }
  }

  const [extras, setExtras] = useState<ExtraRow[]>(() => {
    if (initial == null) return [];
    return Object.entries(initial.extras).map(([label, amount], i) => ({
      id: i + 1,
      label,
      amount: String(amount),
    }));
  });
  const [nextExtraId, setNextExtraId] = useState(
    initial != null ? Object.keys(initial.extras).length + 1 : 1,
  );

  function addExtra() {
    setExtras((prev) => [
      ...prev,
      { id: nextExtraId, label: "", amount: "" },
    ]);
    setNextExtraId((n) => n + 1);
  }

  function updateExtra(id: number, patch: Partial<Omit<ExtraRow, "id">>) {
    setExtras((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  }

  function removeExtra(id: number) {
    setExtras((prev) => prev.filter((e) => e.id !== id));
  }

  const base = Number(baseSalary);
  const extrasSum = extras.reduce((acc, e) => {
    const n = Number(e.amount);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  const total = Number.isFinite(base) ? base + extrasSum : Number.NaN;
  const totalIsNegative = Number.isFinite(total) && total < 0;

  // Serialización de extras para el server action (formData no soporta arrays
  // anidados; pasamos un JSON en un hidden input y el server hace parseExtras).
  const extrasJson = JSON.stringify(
    extras
      .filter((e) => e.label.trim().length > 0)
      .map((e) => ({ label: e.label.trim(), amount: Number(e.amount) || 0 })),
  );

  if (people.length === 0) {
    return (
      <div style={{ padding: 8 }}>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
        >
          No hay personas activas cargadas. Andá a{" "}
          <a
            href="/organizacion/personas"
            style={{ color: "var(--kg-accent-500)" }}
          >
            Organización → Personas
          </a>{" "}
          para dar de alta a alguien y cargarle un sueldo mensual antes de
          liquidar la nómina.
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <Field label="Persona" htmlFor="person_id" required>
        <select
          id="person_id"
          name="person_id"
          value={personId}
          onChange={(e) => handlePersonChange(e.target.value)}
          style={inputStyle}
          required
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
              {p.monthly_salary > 0
                ? ` · ${p.salary_currency === "USD" ? "US$" : "AR$"} ${p.monthly_salary}`
                : " · sin sueldo cargado"}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Inicio del período" htmlFor="period_start" required>
          <input
            id="period_start"
            name="period_start"
            type="date"
            required
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Fin del período" htmlFor="period_end" required>
          <input
            id="period_end"
            name="period_end"
            type="date"
            required
            value={periodEnd}
            min={periodStart}
            onChange={(e) => setPeriodEnd(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Field label="Sueldo base" htmlFor="base_salary" required>
          <input
            id="base_salary"
            name="base_salary"
            type="number"
            step="0.01"
            min="0"
            required
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Moneda" htmlFor="currency">
          <select
            id="currency"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "ARS" | "USD")}
            style={inputStyle}
          >
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <label
            className="kg-t7"
            style={{ color: "var(--kg-text-3)" }}
          >
            Extras (aguinaldo, bonos, descuentos)
          </label>
          <button
            type="button"
            onClick={addExtra}
            className="kg-focus"
            style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 11 }}
          >
            + Agregar extra
          </button>
        </div>
        {extras.length === 0 ? (
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", fontStyle: "italic" }}
          >
            Sin extras. Los montos negativos se toman como descuentos
            (retenciones, adelantos).
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {extras.map((e) => (
              <div
                key={e.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px 36px",
                  gap: 8,
                }}
              >
                <input
                  type="text"
                  placeholder="Concepto (ej. Aguinaldo)"
                  value={e.label}
                  onChange={(ev) =>
                    updateExtra(e.id, { label: ev.target.value })
                  }
                  style={inputStyle}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00 (negativo = descuento)"
                  value={e.amount}
                  onChange={(ev) =>
                    updateExtra(e.id, { amount: ev.target.value })
                  }
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => removeExtra(e.id)}
                  aria-label="Quitar extra"
                  className="kg-focus"
                  style={{
                    ...secondaryBtn,
                    padding: "0",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input type="hidden" name="extras" value={extrasJson} />
      </div>

      <div
        style={{
          padding: "10px 14px",
          borderRadius: "var(--kg-r-8)",
          background: totalIsNegative
            ? "rgba(239,68,68,0.10)"
            : "var(--kg-surface-2-solid)",
          border: totalIsNegative
            ? "1px solid #EF4444"
            : "1px solid var(--kg-border-subtle)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 13,
        }}
      >
        <div>
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Total a pagar ({currency})
          </div>
          {totalIsNegative && (
            <div
              className="kg-t7"
              style={{ color: "#EF4444", marginTop: 2 }}
            >
              El total no puede ser negativo — revisá los descuentos.
            </div>
          )}
        </div>
        <div
          style={{
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: totalIsNegative ? "#EF4444" : "var(--kg-text-1)",
          }}
        >
          {Number.isFinite(total) ? fMoney(total) : "—"}
        </div>
      </div>

      <Field label="Vencimiento" htmlFor="due_date">
        <input
          id="due_date"
          name="due_date"
          type="date"
          style={inputStyle}
          defaultValue={initial?.dueDate ?? initialPeriod.end}
        />
      </Field>

      <Field label="Notas" htmlFor="notes">
        <input
          id="notes"
          name="notes"
          type="text"
          placeholder="Opcional"
          style={inputStyle}
          defaultValue={initial?.notes ?? ""}
        />
      </Field>

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
          disabled={pending || totalIsNegative}
          className="kg-focus"
          style={{
            ...primaryBtn,
            opacity: pending || totalIsNegative ? 0.7 : 1,
          }}
        >
          {pending
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear liquidación"}
        </button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes / estilos
// ═══════════════════════════════════════════════════════════════════════════

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

function monthBoundsToday(): { start: string; end: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
  colorScheme: "dark",
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
