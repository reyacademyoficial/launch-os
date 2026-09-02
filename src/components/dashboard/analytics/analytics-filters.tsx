"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { KgFilterMultiSelect } from "@/components/kg/filter-select";
import { Field, inputStyle } from "@/components/kg/form-primitives";
import { KgPageFilters } from "@/components/kg/page-menu";

/**
 * Filtros compartidos por las 4 vistas de analítica.
 *
 * ── Qué cambió al migrar al KG System ─────────────────────────────────────
 * Antes esto era una grilla `sm:grid-cols-4` INLINE entre el ContextBar y las
 * tabs: dos inputs de fecha y un dropdown `absolute z-20` con checkboxes,
 * todo con tokens viejos (`border-border`, `bg-bg-elevated`, `text-fg-*`).
 * Ocupaba una franja fija de alto en una página cuyo contenido principal son
 * tablas y charts anchos.
 *
 * Ahora el bloque NO se renderiza inline: `KgPageFilters` lo registra en el
 * contexto de `page-menu.tsx` y aparece recién al tocar "Filtros" en el
 * ContextBar (drawer lateral de 400px en desktop, bottom-sheet en mobile).
 * El componente devuelve `null` en el flujo de la página — por eso la page
 * puede seguir montándolo donde estaba sin que ocupe espacio.
 *
 * El multi-select de lanzamientos pasa a `KgFilterMultiSelect`, que se
 * construyó copiando EXACTAMENTE el contrato de serialización que vivía acá
 * (CSV en `?launches`, set vacío = `delete` del param, `router.replace` sin
 * scroll dentro de `startTransition`, resto de los params preservados). O
 * sea: la URL que produce este archivo hoy es byte por byte la misma que
 * producía antes, y `parseAnalyticsFilter` no se toca.
 *
 * ── Por qué NO se usó `RangePills` para las fechas ────────────────────────
 * El `RangePills` de financiero es un selector de PERÍODO: presets relativos
 * al día de hoy ("mes actual", "90 días"), escribe `?range=<preset>` y su
 * modo custom exige from Y to juntos. Acá el rango no es un período contable
 * sino un recorte sobre `date_start` de los lanzamientos, `parseAnalyticsFilter`
 * no entiende `range`, y los dos extremos son independientes (filtrar solo
 * "desde" es un caso real: "todo lo que lanzamos de 2026 en adelante").
 * Forzar ese componente acá implicaría cambiar el parser — que es lógica, no
 * diseño. Quedan dos inputs de fecha con `inputStyle` + `Field` del DS, que
 * es la otra opción que el brief contempla.
 *
 * ── activeCount ──────────────────────────────────────────────────────────
 * Cada extremo de fecha y el multi-select cuentan de a uno; el badge del
 * botón "Filtros" muestra la suma. Es la señal de "estás leyendo un
 * subconjunto" ahora que los controles no están a la vista.
 */
export function AnalyticsFilters({
  launches,
  initialDateFrom,
  initialDateTo,
  initialLaunchIds,
}: {
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly initialDateFrom: string;
  readonly initialDateTo: string;
  readonly initialLaunchIds: ReadonlyArray<string>;
}) {
  const activeCount =
    (initialDateFrom ? 1 : 0) +
    (initialDateTo ? 1 : 0) +
    (initialLaunchIds.length > 0 ? 1 : 0);

  return (
    <KgPageFilters activeCount={activeCount}>
      <DateBoundFilter
        param="from"
        id="analytics-from"
        label="Desde (fecha de lanzamiento)"
        initialValue={initialDateFrom}
        // `max`/`min` cruzados: el picker nativo ya no deja armar un rango
        // invertido. Antes se podía y el server devolvía cero filas sin
        // explicar por qué.
        max={initialDateTo || undefined}
      />
      <DateBoundFilter
        param="to"
        id="analytics-to"
        label="Hasta (fecha de lanzamiento)"
        initialValue={initialDateTo}
        min={initialDateFrom || undefined}
      />

      <KgFilterMultiSelect
        label="Lanzamientos"
        param="launches"
        options={launches.map((l) => ({ label: l.name, value: l.id }))}
        // Ya viene parseado del param por el Server Component. Se llama
        // `initial*` a propósito: dentro del componente es estado optimista y
        // no se re-sincroniza (ver su cabecera).
        initialSelected={initialLaunchIds}
        allLabel="Todos los lanzamientos"
        summaryNoun="lanzamientos"
        emptyLabel="No hay lanzamientos en el proyecto."
      />
    </KgPageFilters>
  );
}

/**
 * Un extremo del rango de fechas. Cada uno commitea su propio param para que
 * "desde" y "hasta" sigan siendo independientes.
 *
 * `onChange` y no `onBlur` (como era antes): dentro de un drawer/sheet el
 * blur puede no llegar nunca — el usuario elige la fecha en el picker nativo
 * y cierra el overlay tocando el backdrop, sin pasar el foco a otro control.
 * Un `<input type="date">` solo emite change con una fecha COMPLETA o con
 * string vacío, así que no hay commits intermedios que disparen navegaciones
 * de más.
 *
 * El input queda no controlado (`defaultValue`): `router.replace` no lo
 * remonta, así que el valor tipeado sobrevive al re-render del server.
 */
function DateBoundFilter({
  param,
  id,
  label,
  initialValue,
  min,
  max,
}: {
  readonly param: "from" | "to";
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
    // Mismo contrato que `commitDate()` tenía acá y que replica
    // `KgFilterMultiSelect`: se copia el querystring entero para no perder
    // `view` (la tab activa), el otro extremo del rango ni `launches`.
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
        // Se atenúa mientras navega, pero NO se deshabilita: en mobile el
        // picker nativo se cierra si el input pierde el enabled a mitad de la
        // interacción.
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
