"use client";

/**
 * KG · RangePills. Selector de rango temporal (7D/30D/90D típico). Pills en
 * un container pill-shaped. El activo se pinta en carmesí sólido con texto
 * blanco — es una excepción justificada a la regla "el número no se pinta"
 * porque la etiqueta acá es un control, no un dato.
 */
export function RangePills<T extends string>({
  value,
  onChange,
  options,
}: {
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly options: readonly T[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        borderRadius: "var(--kg-r-full)",
        padding: 2,
      }}
      role="tablist"
    >
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o)}
            className="kg-focus"
            style={{
              padding: "4px 11px",
              borderRadius: 999,
              border: "none",
              background: active ? "var(--kg-accent-500)" : "transparent",
              color: active ? "#fff" : "var(--kg-text-3)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              transition: "all var(--kg-dur) var(--kg-ease)",
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
