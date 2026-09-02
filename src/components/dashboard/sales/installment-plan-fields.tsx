"use client";

import { useMemo, useState } from "react";

import { Field, inputStyle } from "@/components/kg/form-primitives";
import type { InstallmentFrequency } from "@/lib/commissions/types";
import { fmtDate, fmtMoney } from "@/lib/format";
import { buildInstallmentSchedule } from "@/lib/installments/schedule";

/**
 * Sub-form embebido en NewSaleForm / EditSaleForm: los 3 inputs del plan
 * de pagos + preview reactivo del cronograma. Reproduce en JS lo que hace
 * `generate_installments_for_sale` en Postgres.
 *
 * `totalAmount` y `startDate` no son inputs propios — vienen del form padre
 * y este componente los observa para el preview. El padre los sigue
 * enviando en el mismo submit; acá sólo agregamos count/frequency/grace.
 *
 * MIGRACIÓN AL DS KG
 * Los `Input`/`Label`/`Select` de `@/components/ui` se fueron a favor de
 * `Field` + `inputStyle` (inline styles sobre vars `--kg-*`). El `<select>`
 * es NATIVO a propósito: este bloque vive dentro de un `<form>` que hace
 * submit y `KgFilterSelect` navega con `router.push` en vez de emitir al
 * `FormData` — los `name` (`installment_count`, `installment_frequency`,
 * `grace_days`) son parte del contrato con la server action y no se tocan.
 */
export function InstallmentPlanFields({
  totalAmount,
  startDate,
  defaultCount = 1,
  defaultFrequency = "single",
  defaultGraceDays = 5,
}: {
  readonly totalAmount: number;
  readonly startDate: string;
  readonly defaultCount?: number;
  readonly defaultFrequency?: InstallmentFrequency;
  readonly defaultGraceDays?: number;
}) {
  const [count, setCount] = useState<number>(defaultCount);
  const [frequency, setFrequency] = useState<InstallmentFrequency>(defaultFrequency);
  const [graceDays, setGraceDays] = useState<number>(defaultGraceDays);

  const preview = useMemo(() => {
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return [];
    if (!startDate) return [];
    const effectiveFrequency = count === 1 ? "single" : frequency;
    return buildInstallmentSchedule({
      total: totalAmount,
      count,
      frequency: effectiveFrequency,
      startDate,
    });
  }, [totalAmount, startDate, count, frequency]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Mobile primero: una columna a 390px, tres a partir de sm. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Cantidad de cuotas" htmlFor="sale-inst-count">
          <input
            id="sale-inst-count"
            name="installment_count"
            type="number"
            min="1"
            max="24"
            step="1"
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
            className="kg-focus kg-num"
            style={inputStyle}
          />
        </Field>
        <Field label="Frecuencia" htmlFor="sale-inst-frequency">
          <select
            id="sale-inst-frequency"
            name="installment_frequency"
            value={count === 1 ? "single" : frequency}
            onChange={(e) => setFrequency(e.target.value as InstallmentFrequency)}
            disabled={count === 1}
            className="kg-focus"
            // Con una sola cuota la frecuencia no aplica: se fuerza a "single"
            // y el control se apaga visualmente sin sacarlo del DOM (el form
            // igual tiene que mandar el `name`).
            style={{
              ...inputStyle,
              cursor: count === 1 ? "not-allowed" : "pointer",
              opacity: count === 1 ? 0.55 : 1,
            }}
          >
            <option value="single">Pago único</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
          </select>
        </Field>
        <Field
          label="Días de gracia"
          htmlFor="sale-inst-grace"
          hint="Tolerancia antes de marcar una cuota como vencida."
        >
          <input
            id="sale-inst-grace"
            name="grace_days"
            type="number"
            min="0"
            max="90"
            step="1"
            value={graceDays}
            onChange={(e) => setGraceDays(parseInt(e.target.value, 10) || 0)}
            aria-describedby="sale-inst-grace_hint"
            className="kg-focus kg-num"
            style={inputStyle}
          />
        </Field>
      </div>

      {preview.length > 0 && (
        <div
          style={{
            borderRadius: "var(--kg-r-8)",
            border: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2-solid)",
            padding: 12,
          }}
        >
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 8 }}
          >
            Preview del cronograma
          </div>
          {/*
            Lista y no KgDataTable: son 1-24 pares fecha/monto dentro de un
            form, no un dataset navegable. La tabla del DS traería header,
            footer y sort para algo que se lee de un vistazo.
          */}
          <ul
            className="grid grid-cols-1 gap-1 sm:grid-cols-2"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {preview.map((p) => (
              <li
                key={p.number}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11.5,
                }}
              >
                <span style={{ color: "var(--kg-text-3)" }}>
                  Cuota {p.number} · {fmtDate(p.due_date)}
                </span>
                {/* El monto a la derecha y en kg-num: las cuotas tienen que
                    cerrar verticalmente para leer la magnitud de un vistazo. */}
                <span className="kg-num" style={{ color: "var(--kg-text-1)" }}>
                  {fmtMoney(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
