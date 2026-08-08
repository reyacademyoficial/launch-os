"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Selector de rango temporal para listados del módulo Financiero (facturas,
 * movimientos, gastos). Presenta los presets como pills + una opción
 * "Personalizado" que expone dos inputs de fecha.
 *
 * Al elegir un preset navega a `?range=<preset>` (borra from/to).
 * Al usar el rango custom navega a `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (borra range). Mismo contrato que resolvePeriod ya interpreta.
 *
 * Se sirve como CLIENT COMPONENT porque los inputs son controlados. Las
 * páginas server se lo pasan por props (los presets a mostrar + rango
 * actual) — no importa del propio server component.
 */

export type RangePreset = "todo" | "mes-actual" | "mes-anterior" | "90d";

export interface PresetOption {
  readonly value: RangePreset;
  readonly label: string;
}

export function RangePills({
  presets,
  activePreset,
  activeFrom,
  activeTo,
  baseHref,
}: {
  readonly presets: readonly PresetOption[];
  /** Preset actualmente activo, o null si el rango es custom. */
  readonly activePreset: RangePreset | null;
  /** Fecha inicial si el rango es custom, para prepoblar el input. */
  readonly activeFrom: string | null;
  /** Fecha final si el rango es custom, para prepoblar el input. */
  readonly activeTo: string | null;
  /** Path del listado, ej. "/financiero/facturas". */
  readonly baseHref: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const isCustomActive = activePreset === null;
  const [showCustom, setShowCustom] = useState(isCustomActive);
  const [fromLocal, setFromLocal] = useState(activeFrom ?? "");
  const [toLocal, setToLocal] = useState(activeTo ?? "");

  function goToPreset(value: RangePreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    params.delete("page");
    if (value === "todo") params.delete("range");
    else params.set("range", value);
    setShowCustom(false);
    startTransition(() => {
      const qs = params.toString();
      router.push(qs ? `${baseHref}?${qs}` : baseHref);
    });
  }

  function goToCustom(from: string, to: string) {
    if (!from || !to) return;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.delete("page");
    params.set("from", lo);
    params.set("to", hi);
    startTransition(() => {
      router.push(`${baseHref}?${params.toString()}`);
    });
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        opacity: pending ? 0.6 : 1,
        transition: "opacity var(--kg-dur) var(--kg-ease)",
      }}
      role="group"
      aria-label="Filtrar por período"
    >
      {presets.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => goToPreset(p.value)}
          className="kg-focus"
          style={{
            ...pillStyle,
            background:
              activePreset === p.value
                ? "var(--kg-accent-500)"
                : "transparent",
            color:
              activePreset === p.value ? "#fff" : "var(--kg-text-2)",
          }}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setShowCustom((v) => !v)}
        className="kg-focus"
        style={{
          ...pillStyle,
          background: isCustomActive ? "var(--kg-accent-500)" : "transparent",
          color: isCustomActive ? "#fff" : "var(--kg-text-2)",
        }}
        aria-expanded={showCustom}
      >
        Personalizado
        {isCustomActive && (
          <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.85 }}>
            {activeFrom} → {activeTo}
          </span>
        )}
      </button>

      {showCustom && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <input
            type="date"
            value={fromLocal}
            max={toLocal || undefined}
            onChange={(e) => setFromLocal(e.target.value)}
            style={dateInputStyle}
            aria-label="Fecha desde"
          />
          <span style={{ color: "var(--kg-text-3)", fontSize: 12 }}>→</span>
          <input
            type="date"
            value={toLocal}
            min={fromLocal || undefined}
            onChange={(e) => setToLocal(e.target.value)}
            style={dateInputStyle}
            aria-label="Fecha hasta"
          />
          <button
            type="button"
            onClick={() => goToCustom(fromLocal, toLocal)}
            disabled={!fromLocal || !toLocal || pending}
            className="kg-focus"
            style={{
              ...pillStyle,
              background: "var(--kg-accent-500)",
              color: "#fff",
              padding: "3px 12px",
              opacity: !fromLocal || !toLocal || pending ? 0.5 : 1,
            }}
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  border: "1px solid var(--kg-border-subtle)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  transition: "background var(--kg-dur) var(--kg-ease)",
};

const dateInputStyle: React.CSSProperties = {
  padding: "3px 6px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-1-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  colorScheme: "dark",
};
