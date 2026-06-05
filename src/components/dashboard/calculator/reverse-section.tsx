"use client";

import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
} from "@/lib/format";
import {
  calculateReverse,
  type FunnelStep,
  type ReverseInput,
} from "@/lib/calculator/reverse";

import { CalcKpiCard } from "./calc-kpi-card";

const ACCENT = "#FF006E";
const SUCCESS = "#00D084";
const WARNING = "#FFB800";
const ERROR = "#FF5A5F";
const SKY = "#38BDF8";
const PURPLE = "#C084FC";

export function ReverseSection({
  input,
  setInput,
}: {
  readonly input: ReverseInput;
  readonly setInput: (next: ReverseInput) => void;
}) {
  const output = useMemo(() => calculateReverse(input), [input]);

  const set = <K extends keyof ReverseInput>(key: K) => (value: string) =>
    setInput({ ...input, [key]: value });

  const profitColor = output.profit >= 0 ? SUCCESS : ERROR;
  const roasColor = output.roasProy >= 1 ? SUCCESS : ERROR;
  const margenColor = output.margen > 0 ? SUCCESS : ERROR;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
      {/* Form */}
      <aside className="rounded-md border border-border bg-surface p-5 lg:sticky lg:top-4">
        <div>
          <Label htmlFor="rev-revenueGoal">Revenue Goal ($)</Label>
          <Input
            id="rev-revenueGoal"
            type="number"
            inputMode="decimal"
            min="0"
            step="100"
            value={input.revenueGoal}
            onChange={(e) => set("revenueGoal")(e.target.value)}
            className="!text-base !font-bold"
            style={{ color: ACCENT }}
          />
        </div>

        <SectionHeader>Funnel</SectionHeader>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Ticket ($)"
            id="rev-ticket"
            value={input.ticket}
            onChange={set("ticket")}
            step="50"
          />
          <NumberField
            label="ROAS Obj"
            id="rev-roasTarget"
            value={input.roasTarget}
            onChange={set("roasTarget")}
            step="0.5"
          />
        </div>
        <div className="mt-3 space-y-3">
          <NumberField
            label="Asist. Clase 1 %"
            id="rev-asistClase1"
            value={input.asistClase1}
            onChange={set("asistClase1")}
            step="1"
          />
          <NumberField
            label="Asist. Oferta %"
            id="rev-asistOferta"
            value={input.asistOferta}
            onChange={set("asistOferta")}
            step="1"
          />
          <NumberField
            label="Conv. Oferta → App %"
            id="rev-convOfertaApp"
            value={input.convOfertaApp}
            onChange={set("convOfertaApp")}
            step="1"
          />
          <NumberField
            label="Conv. App → Venta %"
            id="rev-convAppVenta"
            value={input.convAppVenta}
            onChange={set("convAppVenta")}
            step="1"
          />
          <NumberField
            label="CPL ($)"
            id="rev-cpl"
            value={input.cpl}
            onChange={set("cpl")}
            step="0.10"
          />
        </div>

        <SectionHeader>Costos</SectionHeader>
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="Equipo"
            id="rev-equipo"
            value={input.costoEquipo}
            onChange={set("costoEquipo")}
            step="100"
          />
          <NumberField
            label="OpEx"
            id="rev-opex"
            value={input.costoOp}
            onChange={set("costoOp")}
            step="100"
          />
          <NumberField
            label="Comis."
            id="rev-comisiones"
            value={input.comisiones}
            onChange={set("comisiones")}
            step="100"
          />
        </div>
      </aside>

      {/* Outputs */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <CalcKpiCard label="Ventas" value={fmtNumber(output.ventas)} color={ACCENT} />
          <CalcKpiCard label="Apps" value={fmtNumber(output.apps)} color={SKY} />
          <CalcKpiCard
            label="Asist. Oferta"
            value={fmtNumber(output.asistOferta)}
            color={SUCCESS}
          />
          <CalcKpiCard
            label="Asist. Clase 1"
            value={fmtNumber(output.asistClase1)}
            color={WARNING}
          />
          <CalcKpiCard
            label="Leads"
            value={fmtNumber(output.leads)}
            color="var(--color-fg)"
          />
          <CalcKpiCard label="Lead Intent" value={fmtNumber(output.apps)} color={PURPLE} />
          <CalcKpiCard label="Inv. máx" value={fmtMoney(output.invMax)} color={ERROR} />
          <CalcKpiCard label="Budget" value={fmtMoney(output.budget)} color={ERROR} />
          <CalcKpiCard
            label="CPL máx"
            value={fmtMoneyDecimals(output.cplMax)}
            color={SUCCESS}
          />
          <CalcKpiCard
            label="CPA máx"
            value={fmtMoneyDecimals(output.cpaMax)}
            color={WARNING}
          />
          <CalcKpiCard
            label="ROAS proy"
            value={fmtMultiplier(output.roasProy)}
            color={roasColor}
          />
          <CalcKpiCard
            label="BE ROAS"
            value={fmtMultiplier(output.beRoas)}
            color={WARNING}
          />
          <CalcKpiCard
            label="Profit"
            value={fmtMoney(output.profit)}
            color={profitColor}
          />
          <CalcKpiCard
            label="Margen"
            value={fmtPercent(output.margen)}
            color={margenColor}
          />
        </div>

        <FunnelChart steps={output.funnel} />
      </div>
    </div>
  );
}

// ─── inline presentational helpers ────────────────────────────────────────────

function SectionHeader({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="mb-2 mt-5 border-b pb-1 text-[10px] font-bold uppercase tracking-widest"
      style={{ color: ACCENT, borderColor: `${ACCENT}22` }}
    >
      {children}
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

function FunnelChart({ steps }: { readonly steps: readonly FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">Funnel proyectado</h3>
      <div>
        {steps.map((step, i) => (
          <div
            key={step.label}
            className="grid grid-cols-[100px_1fr_70px] items-center gap-3 border-b border-border py-2 last:border-0"
            style={{ borderBottomColor: i === steps.length - 1 ? "transparent" : undefined }}
          >
            <div
              className="text-xs font-semibold"
              style={{ color: step.color }}
            >
              {step.label}
            </div>
            <div className="h-6 overflow-hidden rounded bg-border">
              <div
                className="h-full rounded"
                style={{
                  backgroundColor: `${step.color}66`,
                  width: `${Math.max(3, (step.value / max) * 100)}%`,
                }}
              />
            </div>
            <div className="text-right text-sm font-bold tabular-nums text-fg">
              {fmtNumber(step.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
