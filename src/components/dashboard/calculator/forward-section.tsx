"use client";

import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney, fmtMultiplier, fmtNumber } from "@/lib/format";
import { calculateForward, type ForwardInput } from "@/lib/calculator/forward";

import { CalcKpiCard } from "./calc-kpi-card";

const ACCENT = "#FF006E";
const SUCCESS = "#00D084";
const WARNING = "#FFB800";
const ERROR = "#FF5A5F";

export function ForwardSection({
  input,
  setInput,
}: {
  readonly input: ForwardInput;
  readonly setInput: (next: ForwardInput) => void;
}) {
  const output = useMemo(() => calculateForward(input), [input]);

  const set = <K extends keyof ForwardInput>(key: K) => (value: string) =>
    setInput({ ...input, [key]: value });

  const profitColor = output.profit >= 0 ? SUCCESS : ERROR;
  const roasColor = output.roas >= 1 ? SUCCESS : ERROR;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
      <aside className="rounded-md border border-border bg-surface p-5 lg:sticky lg:top-4">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Budget ($)"
            id="fwd-budget"
            value={input.adBudget}
            onChange={set("adBudget")}
            step="100"
          />
          <NumberField
            label="CPL ($)"
            id="fwd-cpl"
            value={input.cpl}
            onChange={set("cpl")}
            step="0.10"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField
            label="Show Up %"
            id="fwd-showUp"
            value={input.showUp}
            onChange={set("showUp")}
            step="1"
          />
          <NumberField
            label="Close %"
            id="fwd-closeRate"
            value={input.closeRate}
            onChange={set("closeRate")}
            step="1"
          />
        </div>
        <div className="mt-3">
          <NumberField
            label="Ticket ($)"
            id="fwd-ticket"
            value={input.ticket}
            onChange={set("ticket")}
            step="50"
          />
        </div>
      </aside>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <CalcKpiCard
          label="Leads"
          value={fmtNumber(output.leads)}
          color="var(--color-fg)"
        />
        <CalcKpiCard
          label="Asistentes"
          value={fmtNumber(output.asistentes)}
          color={WARNING}
        />
        <CalcKpiCard label="Ventas" value={fmtNumber(output.ventas)} color={ACCENT} />
        <CalcKpiCard label="Revenue" value={fmtMoney(output.revenue)} color={SUCCESS} />
        <CalcKpiCard label="Profit" value={fmtMoney(output.profit)} color={profitColor} />
        <CalcKpiCard
          label="ROAS"
          value={fmtMultiplier(output.roas)}
          color={roasColor}
        />
      </div>
    </div>
  );
}

function NumberField({
  label,
  id,
  value,
  onChange,
  step,
}: {
  readonly label: string;
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly step?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step={step ?? "1"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
