"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

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

/**
 * KG · FilterSelect CONTROLADO — misma pinta, sin navegar.
 *
 * POR QUÉ EXISTE APARTE DEL DE ARRIBA
 * `KgFilterSelect` es URL-first: cada opción trae su `href` y elegir hace
 * `router.push`. Eso es correcto cuando la page server re-fetchea con el
 * filtro aplicado (Financiero, Marketing).
 *
 * Pero hay vistas que filtran EN MEMORIA: la page trae el dataset completo,
 * no parsea ningún query param, y el filtro además alimenta el subset que se
 * exporta a Excel. Llevar eso a la URL convertiría cada cambio de select en
 * una navegación con re-render del server component (refetch entero) más una
 * entrada de historial. Es el caso de `cobros-view` y `project-sales-view`.
 *
 * Los dos se habían copiado este control a mano — la misma pinta, duplicada
 * en dos archivos de 1.500 líneas. Esta variante existe para que no haya dos
 * versiones del mismo select en el repo.
 *
 * Comparte el estilo del control con `KgFilterSelect` vía `filterControlStyle`,
 * así no pueden derivar visualmente.
 */
export function KgFilterSelectControlled({
  id,
  label,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
  readonly ariaLabel?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label
        htmlFor={id}
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </label>
      <select
        id={id}
        className="kg-focus"
        value={value}
        aria-label={ariaLabel ?? label}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...filterControlStyle, cursor: "pointer" }}
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

/** Estilo del `<select>`. Compartido por las dos variantes. */
export const filterControlStyle = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  fontWeight: 600,
} as const;

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

// ═══════════════════════════════════════════════════════════════════════════
// KG · FilterMultiSelect. Multi-selección con checkboxes, serializada a la URL.
//
// ─────────────────────────────────────────────────────────────────────────
// DECISIÓN: componente APARTE, no una prop `multiple` en `KgFilterSelect`
// ─────────────────────────────────────────────────────────────────────────
// Se miraron los dos modos de uso reales antes de decidir:
//
//   · Single (`marketing/subidas`, `edicion`, `planificacion`, `stock`,
//     `disponibilidad`, más `financiero/**`): la PÁGINA —un Server Component—
//     precalcula un `href` por opción con su propio `buildHref()`. El
//     componente no sabe nada de query params; sólo hace `router.push(href)`.
//   · Multi (`analytics-filters.tsx`): imposible precalcular hrefs, son 2^n
//     combinaciones. El componente TIENE que construir la URL él mismo desde
//     `useSearchParams()` y saber el nombre del param.
//
// O sea: no comparten ni el shape de opción (`{label,value,href}` vs
// `{label,value}`), ni la fuente de verdad de la URL, ni el render (un
// `<select>` nativo vs una lista de checkboxes). Meterlos en un componente
// con `multiple` obligaría a un union discriminado donde `href` pasa a ser
// opcional y `active: string | readonly string[]` — es decir, tocar la firma
// que los ~18 call sites en producción de `(kg)/marketing/**` y
// `(kg)/financiero/**` ya consumen. Requisito duro: eso no puede pasar.
// Por eso `KgFilterSelect` queda intacto, byte por byte, y esto vive al lado.
//
// ─────────────────────────────────────────────────────────────────────────
// CONTRATO DE SERIALIZACIÓN — copiado de `analytics-filters.tsx`
// ─────────────────────────────────────────────────────────────────────────
// No se inventa nada. Es exactamente lo que hace su `commitLaunches()`:
//   · CSV de valores en un solo query param  →  `?launches=uuid1,uuid2`
//   · set vacío = "todos"  →  `sp.delete(param)`, NO un `param=` vacío
//   · `router.replace(?..., { scroll: false })` dentro de `startTransition`
//     (replace, no push: los filtros no ensucian el historial del browser)
//   · el resto de los params se preserva copiando `searchParams.toString()`
//     — así `view`, `from`, `to`, la paginación, etc. sobreviven.
// El server lo lee con un `.split(",")`, igual que hoy.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ LA LISTA ES INLINE Y NO UN DROPDOWN `absolute`
// ─────────────────────────────────────────────────────────────────────────
// `analytics-filters.tsx` usa `absolute z-20` porque vive suelto en el body
// de la página. Acá el destino es el overlay de filtros (`page-menu.tsx`):
// drawer lateral de 400px en desktop, bottom-sheet de 85dvh en mobile. Los
// dos tienen `overflow-y: auto` en el body — un hijo `position:absolute`
// queda CLIPEADO por ese scroll container. Así que el panel se expande en
// flujo (disclosure), empujando lo que sigue, con `maxHeight: 240` y scroll
// propio. Bonus: en 390px un dropdown flotante sobre un sheet es intocable
// con el pulgar; una lista en flujo scrollea junto con el resto.
//
// ─────────────────────────────────────────────────────────────────────────
// EJEMPLO DE LLAMADA REAL
// ─────────────────────────────────────────────────────────────────────────
// Mismo shape de datos que `AnalyticsFilters` (`launches: {id,name}[]` +
// `initialLaunchIds: string[]` parseados del param en el Server Component):
//
//   <KgPageFilters activeCount={selectedLaunchIds.length > 0 ? 1 : 0}>
//     <KgFilterMultiSelect
//       label="Lanzamientos"
//       param="launches"
//       options={launches.map((l) => ({ label: l.name, value: l.id }))}
//       initialSelected={selectedLaunchIds}
//       allLabel="Todos los lanzamientos"
//       summaryNoun="lanzamientos"
//       emptyLabel="No hay lanzamientos en el proyecto."
//     />
//   </KgPageFilters>
//
// Con 0 seleccionados el botón dice "Todos los lanzamientos"; con 1, el
// nombre de ese lanzamiento; con N, "N lanzamientos" — el mismo
// `selectedSummary` del consumidor.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilterMultiOption {
  readonly label: string;
  readonly value: string;
}

export function KgFilterMultiSelect({
  label,
  ariaLabel,
  param,
  options,
  initialSelected,
  allLabel = "Todos",
  summaryNoun,
  emptyLabel = "No hay opciones.",
  id,
  defaultOpen = false,
}: {
  readonly label: string;
  /** Override del label accesible del botón disclosure. */
  readonly ariaLabel?: string;
  /** Nombre del query param donde se serializa el CSV. Ej: `"launches"`. */
  readonly param: string;
  readonly options: readonly FilterMultiOption[];
  /**
   * Valores activos al montar, ya parseados del param por el Server
   * Component. Se llama `initial*` a propósito (igual que `initialLaunchIds`
   * en el consumidor): la selección pasa a ser estado local optimista y NO
   * se re-sincroniza si el param cambia por otra vía. Si alguna vez hiciera
   * falta, se remonta con `key={paramValue}` desde el caller — nunca con un
   * `setState` dentro de un `useEffect` (lo prohíbe el ESLint del repo).
   */
  readonly initialSelected: readonly string[];
  /** Texto del resumen con 0 seleccionados = sin filtro. */
  readonly allLabel?: string;
  /** Sustantivo plural del resumen "N ___". Default: el label en minúscula. */
  readonly summaryNoun?: string;
  /** Mensaje cuando `options` viene vacío. */
  readonly emptyLabel?: string;
  readonly id?: string;
  readonly defaultOpen?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSelected),
  );

  const baseId = id ?? `filter-multi-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const listId = `${baseId}-list`;
  const noun = summaryNoun ?? label.toLowerCase();

  const summary = useMemo(() => {
    if (selected.size === 0) return allLabel;
    if (selected.size === 1) {
      // `noUncheckedIndexedAccess`: el [0] de un array derivado tipa
      // `string | undefined` aunque sepamos que size === 1.
      const only = Array.from(selected)[0];
      const match = only == null ? undefined : options.find((o) => o.value === only);
      return match?.label ?? `1 ${noun}`;
    }
    return `${selected.size} ${noun}`;
  }, [selected, options, allLabel, noun]);

  function commit(next: ReadonlySet<string>) {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.size === 0) sp.delete(param);
    else sp.set(param, Array.from(next).join(","));
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `?${qs}` : "?", { scroll: false }));
  }

  function toggle(value: string, checked: boolean) {
    // Calcular `next` ANTES de setSelected — misma razón que documenta
    // `analytics-filters.tsx`: el updater de useState tiene que ser puro, y
    // meter `startTransition` adentro revienta con "Cannot call
    // startTransition while rendering".
    const next = new Set(selected);
    if (checked) next.add(value);
    else next.delete(value);
    setSelected(next);
    commit(next);
  }

  function clear() {
    const empty = new Set<string>();
    setSelected(empty);
    commit(empty);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span className="kg-t7" style={{ color: "var(--kg-text-3)", fontWeight: 600 }}>
        {label}
      </span>

      <button
        id={baseId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? label}
        className="kg-focus"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          // Borde acentuado = el filtro está activo. Señal sin badge extra.
          border: `1px solid ${
            selected.size > 0 ? "var(--kg-border-accent)" : "var(--kg-border-subtle)"
          }`,
          color: "var(--kg-text-1)",
          fontSize: 12,
          fontWeight: 600,
          textAlign: "left",
          opacity: pending ? 0.6 : 1,
          cursor: pending ? "wait" : "pointer",
          transition: "opacity var(--kg-dur) var(--kg-ease)",
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <span aria-hidden="true" style={{ color: "var(--kg-text-3)", flexShrink: 0 }}>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {/* Disclosure en flujo, no `position:absolute` — ver la nota de arriba
          sobre el clipping del drawer/bottom-sheet. */}
      <div
        id={listId}
        role="group"
        aria-labelledby={baseId}
        hidden={!open}
        style={{
          maxHeight: 240,
          overflowY: "auto",
          borderRadius: "var(--kg-r-8)",
          border: "1px solid var(--kg-border-subtle)",
          background: "var(--kg-surface-1-solid)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid var(--kg-border-subtle)",
            position: "sticky",
            top: 0,
            background: "var(--kg-surface-1-solid)",
          }}
        >
          <span className="kg-t7 kg-num" style={{ color: "var(--kg-text-3)" }}>
            {selected.size} de {options.length}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={selected.size === 0 || pending}
            className="kg-focus"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--kg-accent-text)",
              cursor: selected.size === 0 ? "default" : "pointer",
              opacity: selected.size === 0 ? 0.4 : 1,
            }}
          >
            Limpiar
          </button>
        </div>

        {options.length === 0 ? (
          <p
            className="kg-t6"
            style={{ margin: 0, padding: 12, color: "var(--kg-text-3)" }}
          >
            {emptyLabel}
          </p>
        ) : (
          options.map((o) => (
            <label
              key={o.value}
              className="kg-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                // ~36px de alto de toque: el mínimo cómodo en el sheet mobile.
                padding: "9px 12px",
                fontSize: 12,
                color: "var(--kg-text-2)",
                cursor: pending ? "wait" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={(e) => toggle(o.value, e.target.checked)}
                disabled={pending}
                className="kg-focus"
                style={{ accentColor: "var(--kg-accent-500)", flexShrink: 0 }}
              />
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{o.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
