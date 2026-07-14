"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="sale-inst-count">Cantidad de cuotas</Label>
          <Input
            id="sale-inst-count"
            name="installment_count"
            type="number"
            min="1"
            max="24"
            step="1"
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
          />
        </div>
        <div>
          <Label htmlFor="sale-inst-frequency">Frecuencia</Label>
          <Select
            id="sale-inst-frequency"
            name="installment_frequency"
            value={count === 1 ? "single" : frequency}
            onChange={(e) => setFrequency(e.target.value as InstallmentFrequency)}
            disabled={count === 1}
          >
            <option value="single">Pago único</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="sale-inst-grace">Días de gracia</Label>
          <Input
            id="sale-inst-grace"
            name="grace_days"
            type="number"
            min="0"
            max="90"
            step="1"
            value={graceDays}
            onChange={(e) => setGraceDays(parseInt(e.target.value, 10) || 0)}
          />
          <p className="mt-1 text-xs text-fg-subtle">
            Tolerancia antes de marcar una cuota como vencida.
          </p>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="rounded-md border border-border bg-surface/40 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">
            Preview del cronograma
          </div>
          <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {preview.map((p) => (
              <li
                key={p.number}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-fg-muted">
                  Cuota {p.number} · {fmtDate(p.due_date)}
                </span>
                <span className="tabular-nums text-fg">
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
