"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// KG · FilterSelect. Alternativa vertical / compacta a `KgParamPills` para
// filtros con muchas opciones (owner, editor, platform, format, etc.).
//
// Cabe en un drawer angosto (400px) porque es un `<select>` nativo, y ahorra
// el scroll horizontal que las pills producen cuando los labels son largos
// o el set de opciones crece.
//
// Contract del caller: mismo modelo que `KgParamPills` — se pasa un array de
// opciones con `label` + `value` + `href`. El active se marca automáticamente
// por match con `value` actual. Al elegir, navega al `href` correspondiente.
//
// Sin fetch propio. Sin estado local — el `value` es siempre la prop `active`
// (controlado); el useTransition solo evita que el UI aparezca congelado
// mientras Next hace client-side transition.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilterSelectOption {
  readonly label: string;
  readonly value: string;
  readonly href: string;
}

export function KgFilterSelect({
  label,
  ariaLabel,
  options,
  active,
  id,
}: {
  readonly label: string;
  /** Se usa si querés override del label visual (por accesibilidad). */
  readonly ariaLabel?: string;
  readonly options: readonly FilterSelectOption[];
  /** El `value` que está activo. Debe matchear uno de `options[].value`. */
  readonly active: string;
  /** ID único para vincular <label>/<select>. Auto si no se pasa. */
  readonly id?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const selectId = id ?? `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;

  function handleChange(nextValue: string) {
    const opt = options.find((o) => o.value === nextValue);
    if (!opt) return;
    startTransition(() => {
      router.push(opt.href);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label
        htmlFor={selectId}
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </label>
      <select
        id={selectId}
        value={active}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        aria-label={ariaLabel ?? label}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-1)",
          fontSize: 12,
          fontWeight: 600,
          colorScheme: "dark",
          opacity: pending ? 0.6 : 1,
          cursor: pending ? "wait" : "pointer",
          transition: "opacity var(--kg-dur) var(--kg-ease)",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
