import Link from "next/link";

/**
 * KG · ParamPills. Pills que reflejan un `searchParam` de la URL. Server-side
 * puro — sin estado de cliente, sin `usePathname`. El caller arma el href de
 * cada opción y decide cuál está activa; este componente solo pinta.
 *
 * Se usa en las pestañas de Financiero para filtros de status y de período
 * (?status=cobrada, ?range=90d, etc.). Cada page conoce su lógica de query,
 * así que armar el href allá es más simple que pasar un objeto de filtros y
 * dejar que el componente compute — evita una abstracción prematura.
 */

export interface ParamPillOption {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}

export function KgParamPills({
  options,
  ariaLabel,
}: {
  readonly options: readonly ParamPillOption[];
  readonly ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: "var(--kg-r-full)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      {options.map((o) => (
        <Link
          key={o.href + o.label}
          href={o.href}
          className="kg-focus"
          role="tab"
          aria-selected={o.active}
          style={{
            padding: "4px 12px",
            borderRadius: 999,
            background: o.active ? "var(--kg-accent-500)" : "transparent",
            color: o.active ? "#fff" : "var(--kg-text-2)",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
