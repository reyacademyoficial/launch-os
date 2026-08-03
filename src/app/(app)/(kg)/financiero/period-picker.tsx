"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Selector de rango de fechas para el dashboard Financiero. Reemplaza los
 * pills de presets con dos `<input type="date">` (calendarios nativos del
 * navegador — misma UX que el resto del módulo: transferencias, movimientos,
 * gastos). Al cambiar cualquiera de los dos, navega a `?from=YYYY-MM-DD&to=…`
 * y la page (server component) re-resuelve el `Period`.
 *
 * Reglas:
 *   - Ambos inputs son controlados por el YMD que devuelve `resolvePeriod`, así
 *     que si el usuario cae con `?range=90d`, los inputs muestran la ventana
 *     efectiva de esos 90 días (no vacío).
 *   - `router.push` dentro de `startTransition` para que Next marque la
 *     navegación como pendiente y el UI no parezca colgado en fetches largos.
 *   - Si el usuario pisa un input y borra la fecha (value=""), NO navegamos —
 *     preferimos esperar a que ponga la nueva antes de disparar el server.
 */
export function PeriodPicker({
  fromYmd,
  toYmd,
}: {
  readonly fromYmd: string;
  readonly toYmd: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.set("from", nextFrom);
    params.set("to", nextTo);
    startTransition(() => {
      router.push(`/financiero?${params.toString()}`);
    });
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        opacity: pending ? 0.6 : 1,
        transition: "opacity var(--kg-dur) var(--kg-ease)",
      }}
      role="group"
      aria-label="Rango de fechas"
    >
      <label style={labelStyle} htmlFor="fin-from">
        Desde
      </label>
      <input
        id="fin-from"
        type="date"
        value={fromYmd}
        max={toYmd}
        onChange={(e) => navigate(e.target.value, toYmd)}
        style={inputStyle}
        aria-label="Fecha desde"
      />
      <label style={labelStyle} htmlFor="fin-to">
        Hasta
      </label>
      <input
        id="fin-to"
        type="date"
        value={toYmd}
        min={fromYmd}
        onChange={(e) => navigate(fromYmd, e.target.value)}
        style={inputStyle}
        aria-label="Fecha hasta"
      />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--kg-text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  colorScheme: "dark",
};
