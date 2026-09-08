"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Field, inputStyle } from "./form-primitives";

/**
 * Filtro de rango de fecha (`?<fromParam>=&<toParam>=`) para usar dentro de
 * `KgPageFilters`. Extraído de `AnalyticsFilters` (mismo contrato de
 * serialización: copia el querystring completo para no perder otros filtros,
 * `onChange` en vez de `onBlur` porque dentro de un drawer/sheet el blur
 * puede no llegar nunca, input no controlado con `defaultValue` para que
 * sobreviva al re-render del server).
 */
export function KgDateRangeFilter({
  fromParam,
  toParam,
  fromLabel = "Desde",
  toLabel = "Hasta",
  initialFrom,
  initialTo,
}: {
  readonly fromParam: string;
  readonly toParam: string;
  readonly fromLabel?: string;
  readonly toLabel?: string;
  readonly initialFrom: string;
  readonly initialTo: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <DateBound
        param={fromParam}
        id={`${fromParam}-input`}
        label={fromLabel}
        initialValue={initialFrom}
        max={initialTo || undefined}
      />
      <DateBound
        param={toParam}
        id={`${toParam}-input`}
        label={toLabel}
        initialValue={initialTo}
        min={initialFrom || undefined}
      />
    </div>
  );
}

function DateBound({
  param,
  id,
  label,
  initialValue,
  min,
  max,
}: {
  readonly param: string;
  readonly id: string;
  readonly label: string;
  readonly initialValue: string;
  readonly min?: string;
  readonly max?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function commit(value: string) {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (value) sp.set(param, value);
    else sp.delete(param);
    const qs = sp.toString();
    startTransition(() =>
      router.replace(qs ? `?${qs}` : "?", { scroll: false }),
    );
  }

  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="date"
        defaultValue={initialValue}
        min={min}
        max={max}
        onChange={(e) => commit(e.target.value)}
        className="kg-focus kg-num"
        style={{
          ...inputStyle,
          fontVariantNumeric: "tabular-nums",
          opacity: pending ? 0.6 : 1,
          transition: "opacity var(--kg-dur) var(--kg-ease)",
        }}
      />
    </Field>
  );
}
