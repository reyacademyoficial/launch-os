"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fmtUsdDecimals } from "@/lib/money";

import {
  createFxRate,
  deleteFxRate,
  type CreateFxRateState,
} from "./actions";

export interface FxRateRowData {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly month: string;
  readonly arsPerUsd: number;
}

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

export function TasasView({
  rows,
  projects,
  totalCount,
}: {
  readonly rows: readonly FxRateRowData[];
  readonly projects: readonly ProjectOption[];
  readonly totalCount: number;
}) {
  const columns: Column<FxRateRowData>[] = [
    { key: "project", label: "Proyecto", render: (r) => r.projectName },
    { key: "month", label: "Mes", render: (r) => formatMonth(r.month) },
    {
      key: "rate",
      label: "Tasa ARS / USD",
      align: "right",
      numeric: true,
      render: (r) => fmtUsdDecimals(r.arsPerUsd).replace("US$ ", ""),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => <DeleteButton rateId={r.id} />,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        <CreateFxRateForm projects={projects} />
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay tasas cargadas"
        emptyHint="Las tasas mensuales se usan para convertir a USD gastos, nómina, movimientos y facturas que no están atados a un lanzamiento. Los cobros de un launch usan la tasa del launch."
      />
    </div>
  );
}

function CreateFxRateForm({
  projects,
}: {
  readonly projects: readonly ProjectOption[];
}) {
  const [state, formAction, pending] = useActionState<
    CreateFxRateState,
    FormData
  >(createFxRate, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) formRef.current?.reset();
  }, [state]);

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-end",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label
          htmlFor="fx_project_id"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)" }}
        >
          Proyecto
        </label>
        <select
          id="fx_project_id"
          name="project_id"
          required
          defaultValue=""
          style={inputStyle}
        >
          <option value="">Elegí…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label
          htmlFor="fx_month"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)" }}
        >
          Mes
        </label>
        <input
          id="fx_month"
          name="month"
          type="month"
          required
          defaultValue={currentMonth}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label
          htmlFor="fx_rate"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)" }}
        >
          Tasa ARS / USD
        </label>
        <input
          id="fx_rate"
          name="ars_per_usd"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="ej. 1200"
          style={{ ...inputStyle, width: 140 }}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="kg-focus"
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          background: "var(--kg-accent-500)",
          border: "none",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? "Cargando…" : "Agregar tasa"}
      </button>

      {state && "error" in state && (
        <div
          style={{
            width: "100%",
            color: "#EF4444",
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {state.error}
        </div>
      )}
    </form>
  );
}

function DeleteButton({ rateId }: { readonly rateId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!confirm("¿Borrar esta tasa? Los dashboards del mes van a perder la conversión hasta que cargues otra.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await deleteFxRate(rateId);
      if ("error" in r) setError(r.error);
    });
  }

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        justifyContent: "flex-end",
        alignItems: "center",
      }}
    >
      {error && (
        <span style={{ color: "#EF4444", fontSize: 10 }} title={error}>
          ⚠
        </span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="kg-focus"
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "#EF4444",
          fontSize: 11,
          fontWeight: 700,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "…" : "Borrar"}
      </button>
    </div>
  );
}

/**
 * `2026-07-01` → `julio 2026`. es-AR. Trato manual del YYYY-MM-DD para
 * evitar el shift de timezone (mismo patrón que `monthKey` en @/lib/money).
 */
function formatMonth(m: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(m);
  if (!match) return m;
  const y = Number(match[1]);
  const mm = Number(match[2]);
  return new Date(Date.UTC(y, mm - 1, 1))
    .toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 13,
};
